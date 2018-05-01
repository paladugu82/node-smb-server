/*
 *  Copyright 2015 Adobe Systems Incorporated. All rights reserved.
 *  This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License. You may obtain a copy
 *  of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software distributed under
 *  the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *  OF ANY KIND, either express or implied. See the License for the specific language
 *  governing permissions and limitations under the License.
 */

'use strict';

var os = require('os');
var net = require('net');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var logger = require('./logging').getLogger('default');
var _ = require('lodash');
var async = require('async');

var common = require('./common');
var utils = require('./utils');
var DefaultAuthenticator = require('./defaultauthenticator');
var ntlm = require('./ntlm');
var SMBConnection = require('./smbconnection');
var SMBLogin = require('./smblogin');
var SMBSession = require('./smbsession');
var SMBShare = require('./smbshare');
var IPCShare = require('./backends/ipc/share');
var SMBContext = require('./smbcontext');

/**
 * SMB Server
 *
 * events:
 * - error: error
 * - started
 * - terminated
 * - shareConnected: shareName
 * - shareDisconnected: shareName
 * - fileCreated: shareName, path
 * - folderCreated: shareName, path
 * - fileDeleted: shareName, path
 * - folderDeleted: shareName, path
 * - itemMoved: shareName, oldPath, newPath
 * - folderListed: shareName, path
 *
 * @param {Object} config - configuration hash
 * @param {Authenticator} authenticator
 * @constructor
 */
function SMBServer(config, authenticator) {
  // call the super constructor to initialize `this`
  EventEmitter.call(this);

  this.tcpServer = net.createServer();
  this.connections = {};
  this.openSockets = {};
  this.logins = {};
  this.sessions = {};
  this.shares = {};
  this.trees = {};
  // todo load/persist generated server guid
  this.guid = utils.generateRawUUID();
  this.domainName = config && config.domainName || '';
  this.hostName = os.hostname();
  this.nativeOS = os.type() + ' ' + os.release();
  this.nativeLanMan = common.NATIVE_LANMAN;
  this.config = config && _.cloneDeep(config) || {};
  this.authenticator = authenticator || new DefaultAuthenticator(config);
  // init shares
  var self = this;
  _.forEach(config.shares,
    function (shareCfg, name) {
      var type = shareCfg.backend;
      var Share = require('./backends/' + type + '/share');
      name = name.toUpperCase();  // share names are uppercase
      var share = new SMBShare(self, new Share(name, shareCfg));
      self.shares[name] = share;
      share.on('shareEvent', function (arg) {
        self.emit('serverEvent', arg);
      });
    }
  );
  // add IPC$ share
  this.shares['IPC$'] = new SMBShare(this, new IPCShare('IPC$', {}));

  this.tcpServer.on('connection', function (socket) {
    socket.setNoDelay(true);
    socket.id = ++SMBServer.connectionIdCounter;

    logger.info('established client connection #%d from [%s:%d] -> [%s:%d]', socket.id, socket.remoteAddress, socket.remotePort, socket.localAddress, socket.localPort);

    // setup socket event handlers
    socket.on('end', function () {
      logger.info('client #%d disconnected (received: %dkb, sent: %dkb)', socket.id,  Math.floor(socket.bytesRead / 1000), Math.floor(socket.bytesWritten / 1000));
    });

    socket.on('error', function (err) {
      logger.info('client #%d [%s:%d] connection error', socket.id, socket.remoteAddress, socket.remotePort, err);
      logger.error(err);
    });

    socket.on('close', function (hadError) {
      delete self.openSockets[socket.id];
      delete self.connections[socket.id];
    });

    // create a new SMBConnection instance per tcp socket connection
    self.connections[socket.id] = new SMBConnection(socket, self);
    // remember all open sockets so they can be destroyed on close
    self.openSockets[socket.id] = socket;
  });

  this.tcpServer.on('error', this.onError.bind(this));
  this.tcpServer.on('close', this.onClose.bind(this));
}

util.inherits(SMBServer, EventEmitter);

SMBServer.connectionIdCounter = 0;

SMBServer.prototype.onError = function (err) {
  logger.error(err);
  this.emit('error', err);
};

SMBServer.prototype.onClose = function () {
  logger.info('[%s] SMB server stopped', process.pid);
  this.emit('terminated');
};

SMBServer.prototype.start = function (port, host, cb) {
  var self = this;
  this.tcpServer.listen(port, host, function () {
    var realPort = this.address().port;
    logger.info('[%s] SMB server started listening on port %d', process.pid, realPort);
    self.emit('started');
    self.tsStarted = Date.now();
    cb();
  });
};

SMBServer.prototype.stop = function (cb) {
  logger.debug('[%s] SMB server closing tcp server to future connections', process.pid);
  this.tcpServer.close(function (err) {
    if (err) {
      logger.error(err);
    }
    logger.debug('[%s] SMB server closed tcp server', process.pid);
    cb(err);
  });
  logger.debug('[%s] SMB server destroying open connections', process.pid);
  _.forEach(this.openSockets,
    function (socket, socketId) {
      logger.debug('[%s] SMB server destroyed open connection %s', process.pid, socketId);
      socket.destroy();
    }
  );
};

SMBServer.prototype.getGuid = function () {
  return this.guid;
};

SMBServer.prototype.getStartTime = function () {
  return this.tsStarted;
};

SMBServer.prototype.createLogin = function () {
  var login = new SMBLogin(this, ntlm.createChallenge());
  // register login
  this.logins[login.key] = login;
  return login;
};

SMBServer.prototype.getLogin = function (key) {
  return this.logins[key];
};

SMBServer.prototype.destroyLogin = function (key) {
  delete this.logins[key];
};

/**
 *
 * @param {SMBLogin} login
 * @param {String} accountName
 * @param {String} primaryDomain
 * @param {Buffer} caseInsensitivePassword
 * @param {Buffer} caseSensitivePassword
 * @param {Function} cb callback called with the authenticated session
 * @param {String|Error} cb.error error (non-null if an error occurred)
 * @param {SMBSession} cb.session authenticated session
 */
SMBServer.prototype.setupSession = function (login, accountName, primaryDomain, caseInsensitivePassword, caseSensitivePassword, cb) {
  var self = this;
  this.authenticator.authenticate(login.challenge, caseInsensitivePassword, caseSensitivePassword, primaryDomain, accountName, function (err, session) {
    if (err) {
      cb(err);
      return;
    }
    var smbSession = new SMBSession(self, accountName, primaryDomain, session);
    // register session
    self.sessions[smbSession.uid] = smbSession;
    cb(null, smbSession);
  });
};

SMBServer.prototype.getSession = function (uid) {
  return this.sessions[uid];
};

SMBServer.prototype.destroySession = function (uid) {
  delete this.sessions[uid];
};

SMBServer.prototype.getShareNames = function () {
  return _.keys(this.shares);
};

SMBServer.prototype.listShares = function () {
  var result = [];
  _.forEach(this.shares, function (share, nm) {
    result.push({ name: share.getName(), description: share.getDescription() });
  });
  return result;
};

/**
 * Refresh a specific folder on a specific share.
 *
 * @param {String} shareName
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {String|Error} cb.error error (non-null if an error occurred)
 */
SMBServer.prototype.refresh = function (shareName, folderPath, deep, cb) {
  // share names are uppercase
  shareName = shareName.toUpperCase();

  if (!this.shares[shareName]) {
    process.nextTick(function () { cb(new Error('share not found')); });
    return;
  }

  // walk connected trees and find tree associated with specified share
  var tree = null;
  _.forOwn(this.trees, function (t) {
    if (t.getShare().getName() === shareName) {
      // found matching connected share
      tree = t.createTree(new SMBContext().withLabel('server_refresh'));
      return false;
    }
  });

  if (!tree) {
    process.nextTick(function () { cb(new Error('share not connected')); });
    return;
  }

  tree.refresh(folderPath, deep, cb);
};

/**
 *
 * @param {SMBSession} session
 * @param {String} shareName
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {String|Error} cb.error error (non-null if an error occurred)
 * @param {SMBSession} cb.session authenticated session
 */
SMBServer.prototype.connectTree = function (session, shareName, shareLevelPassword, cb) {
  var share = this.shares[shareName];
  if (!share) {
    process.nextTick(function () { cb(new Error('share not found')); });
    return;
  }
  var self = this;
  share.connect(session, shareLevelPassword, function (err, tree) {
    if (err) {
      cb(err);
    } else {
      // register tree
      self.trees[tree.tid] = tree;
      cb(null, tree);
      // emit event
      self.emit('shareConnected', shareName);
    }
  });
};

function _getTreeConnection(tid) {
  return this.trees[tid];
};

SMBServer.prototype.createContext = function (tid) {
  var tree = _getTreeConnection.call(this, tid);
  var context;
  if (tree) {
    context = tree.createContext();
  } else {
    context = new SMBContext().withLabel('smbserver.createContext');
  }
  context.withDetail('sid', utils.rawUUIDToString(this.guid));
  return context;
};

SMBServer.prototype.getTree = function (tid, context) {
  if (!context) {
    context = this.createContext(tid).withLabel('smbserver.getTree');
  }
  return this.trees[tid].createTree(context);
};

SMBServer.prototype.disconnectTree = function (tid) {
  var tree = this.trees[tid];
  if (tree) {
    var shareName = tree.getShare().getName();
    tree.disconnect();
    delete this.trees[tid];
    // emit event
    this.emit('shareDisconnected', shareName);
  }
};


/**
 * Clears the server's cache.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {string|Error} cb.err Will be truthy if there were errors during the operation.
 */
SMBServer.prototype.clearCache = function (cb) {
  var context = new SMBContext().withLabel('server_clear_cache');
  async.each(this.trees, function (t, callback) {
    t.createTree(context).clearCache(callback);
  }, cb);
};

/**
 * Provides an interface for generically passing event requests to the server. The server will either process
 * the event itself (depending on the eventName) or pass the event to its underlying shares.
 * @param {string} eventName The name of the event to process.
 * @param {object} data Information that will be passed along with the event.
 * @param [Function] callback If supplied, and depending on the event, will be invoked when the operation is complete.
 */
SMBServer.prototype.processEvent = function (eventName, data, callback) {
  var self = this;
  var context = new SMBContext().withLabel('server_process_event');
  context.spi().debug('smb server received processEvent with eventName: %s', eventName);
  _.forOwn(self.shares, function (value) {
    value.onServerEvent(context, eventName, data, callback);
  });
};

module.exports = SMBServer;

