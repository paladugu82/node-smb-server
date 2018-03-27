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

var util = require('util');
var logger = require('../../logging').getLogger('spi');
var rqlog = require('../../logging').getLogger('rq');

var TreeConnection = require('../../spi/treeconnection');
var RQTree = require('./tree');
var RequestQueue = require('./requestqueue');
var RQProcessor = require('./rqprocessor');
var FSTreeConnection = require('../fs/treeconnection');
var FSShare = require('../fs/share');

/**
 * Creates an instance of TreeConnection.
 *
 * @constructor
 * @this {TreeConnection}
 */
var RQTreeConnection = function (share, remote, options) {
  if (!(this instanceof RQTreeConnection)) {
    return new RQTreeConnection(share, remote, options);
  }
  TreeConnection.call(this, share.config);
  options = options || {};

  var self = this;
  this.options = options;
  this.remoteTreeConnection = remote;
  this.share = share;
  this.localTreeConnection = new FSTreeConnection(new FSShare('rqlocal', share.config.local));
  this.rq = new RequestQueue({
    path: share.config.work.path
  });
  share.emitShareEvent('requestqueueinit', this.rq);
  this.processor = new RQProcessor(this, share.config);

  this.processor.on('syncstart', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.info('start sync %s %s', data.method, data.file);
    share.emitShareEvent('syncfilestart', data);
  });

  this.processor.on('syncend', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.info('end sync %s %s', data.method, data.file);
    share.emitShareEvent('syncfileend', data);
  });

  this.processor.on('syncerr', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.error('err sync %s %s', data.method, data.file, data.err);
    share.emitShareEvent('syncfileerr', data);
  });

  this.processor.on('error', function (err) {
    logger.error('there was a general error in the processor', err);
    share.emitShareEvent('syncerr', {err: err});
  });

  this.processor.on('purged', function (purged) {
    logger.info('failed files were purged from the queue', purged);
    share.emitShareEvent('syncpurged', {files: purged});
  });

  this.processor.on('syncabort', function (data) {
    logger.info('abort sync %s', data.file);
    share.emitShareEvent('syncfileabort', data);
  });

  this.processor.on('syncprogress', function (eventData) {
    var data = eventData.data;
    var log = eventData.context.spi();
    log.debug('sync progress %s', data.path);
    share.emitShareEvent('syncfileprogress', data);
  });

  this.share.on('uploadasset', function (eventDataObj) {
    var eventData = eventDataObj.options;
    self.processor.syncPath(eventData.path, {
      remotePrefix: self.share.getRemotePrefix(),
      localPrefix: self.share.getLocalPrefix(),
      isDelete: eventData.isDelete
    });
  });

  this.share.on('downloadasset', function (eventData) {
    _downloadAsset.call(self, eventData.context, eventData.options, eventData.callback);
  });

  this.share.on('checkcachesize', function (eventData) {
    var log = eventData.context.spi();
    log.debug('tree connection received event checkcachesize');
    var tree = self.createTree(eventData.context);
    tree.checkCacheSize(eventData.options.maxCacheSize, eventData.options.forceEvent);
  });

  this.share.on('cancelupload', function (eventData) {
    self.processor.abortUpload(eventData.options.path);
  });

  if (!options.noprocessor) {
    this.processor.start(share.config);
  }
};

util.inherits(RQTreeConnection, TreeConnection);

function _downloadAsset(context, data, callback) {
  var self = this;
  var tree = self.createTree(context);
  var logger = tree.getLogger();
  var path = data.path;

  function handleExists(callback) {
    tree.local.exists(path, function (err, exists) {
      if (err) {
        logger.error('unable to download file %s to local cache due to error', path, err);
        return;
      }

      if (exists) {
        if (data.force) {
          tree.local.delete(path, function (err) {
            if (err) {
              logger.error('unable to re-download file %s to local cache due to error', path, err);
              return;
            }
            callback();
          });
        } else {
          _invokeCallback();
        }
      } else {
        callback();
      }
    });
  }

  function _invokeCallback(err) {
    logger.debug('_invokeCallback: entering');
    if (callback) {
      logger.debug('_invokeCallback: invoking callback');
      callback(err);
    }
  }

  handleExists(function () {
    logger.info('downloading file %s to local cache by request of server', path);
    tree.local.download(tree.remote, path, function (err) {
      if (err) {
        logger.error('unable to download file %s to local cache due to error', path, err);
        _invokeCallback(err);
      } else {
        logger.info('successfully downloaded file %s to local cache by request of server', path);
        _invokeCallback();
      }
    });
  });
};

/**
 * Creates a new Tree instance that can be used for interacting with the tree.
 * @param {SMBContext} context The context that will be given to the tree.
 */
RQTreeConnection.prototype.createTree = function (context) {
  return new RQTree(this, context, this.remoteTreeConnection.createTree(context), this.localTreeConnection.createTree(context));
};

/**
 * Disconnect this tree.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
RQTreeConnection.prototype.disconnect = function (cb) {
  rqlog.debug('RQTree.disconnect');
  var self = this;
  if (!self.options.noprocessor) {
    self.processor.stop();
  }
  self.remoteTreeConnection.disconnect(function (remoteErr) {
    self.localTreeConnection.disconnect(function (localErr) {
      if (remoteErr || localErr) {
        var err = [];
        if (remoteErr) {
          err.push(remoteErr);
        }
        if (localErr) {
          err.push(localErr);
        }
        cb(err);
      } else {
        cb();
      }
    });
  });
};

module.exports = RQTreeConnection;
