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

var Util = require('util');
var async = require('async');

var utils = require('../../utils');
var webutils = require('../../webutils');
var JCRShare = require('../jcr/share');
var DAMTreeConnection = require('./treeconnection');
var JCR = require('../jcr/constants');
var DAM = require('./constants');
var Path = require('path');
var log = require('../../logging').getLogger('spi');
var ntstatus = require('../../ntstatus');
var SMBError = require('../../smberror');
var fs = require('fs');

/**
 * Creates an instance of JCRShare.
 *
 * @constructor
 * @this {DAMShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var DAMShare = function (name, config) {
  if (!(this instanceof DAMShare)) {
    return new DAMShare(name, config);
  }

  this.contextPath = '';

  config = config || {};
  if (!config.path) {
    config.path = DAM.DAM_ROOT_PATH;
  } else {
    // check for context path
    if (config.path.indexOf(DAM.DAM_ROOT_PATH) > 0) {
      this.contextPath = config.path.substr(0, config.path.indexOf(DAM.DAM_ROOT_PATH));
    }
  }
  JCRShare.call(this, name, config);
};

// the DAMShare prototype inherits from JCRShare
Util.inherits(DAMShare, JCRShare);

DAMShare.prototype.isAssetClass = function (entity) {
  var cls = (entity && entity[DAM.CLASS]) || [];
  return cls.indexOf(DAM.CLASS_ASSET) > -1;
};

DAMShare.prototype.isFolderClass = function (entity) {
  var cls = (entity && entity[DAM.CLASS]) || [];
  return cls.indexOf(DAM.CLASS_FOLDER) > -1;
};

//-----------------------------------------------------------------< JCRShare >

DAMShare.prototype.getContent = function (tree, path, deep, cb) {
  var self = this;
  if (deep) {
    // for folder lists, use default implementation
    JCRShare.prototype.getContent.call(self, tree, path, deep, cb);
  } else {
    // for individual entities, retrieve the parent's folder list and use the entity information from there.
    // this is to avoid the need to make an extra HTTP request when retrieving information about individual items
    var parent = utils.getParentPath(path);
    var name = utils.getPathName(path);
    self.getContent(tree, parent, true, function (err, parentContent) {
      if (err) {
        cb(err);
      } else {
        if (parent == path) {
          // it's the root path
          cb(null, parentContent);
        } else if (parentContent) {
          // find the entity in the parent's list of entities
          var entities = parentContent[DAM.ENTITIES];
          if (!entities) {
            // no entities found, return null
            cb(null, null);
          } else {
            var i;
            var entityContent = null;
            for (i = 0; i < entities.length; i++) {
              if (entities[i][DAM.PROPERTIES]) {
                var currName = entities[i][DAM.PROPERTIES][DAM.NAME];
                if (currName == name) {
                  entityContent = entities[i];
                  break;
                }
              }
            }
            cb(null, entityContent);
          }
        } else {
          // no parent content found, return null
          cb(null, null);
        }
      }
    });
  }
};

DAMShare.prototype.parseContentChildEntries = function (content, iterator) {
  var self = this;
  var entities = content[DAM.ENTITIES] || [];
  entities.forEach(function (entity) {
    var nm = entity[DAM.PROPERTIES] && entity[DAM.PROPERTIES][DAM.NAME];
    if (nm) {
      if (self.isAssetClass(entity) || self.isFolderClass(entity)) {
        iterator(nm, entity);
      }
    }
  });
};

DAMShare.prototype.buildUrlRoot = function () {
  return this.protocol + '//' + this.host + ':' + this.port + this.contextPath;
};

DAMShare.prototype.buildContentUrl = function (path, depth) {
  return this.buildUrlRoot(path) + DAM.ASSETS_API_PATH + encodeURI(utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path)) + '.json';
};

DAMShare.prototype.buildResourceUrl = function (path) {
  return this.buildUrlRoot(path) + this.buildResourcePath(path);
};

DAMShare.prototype.buildResourcePath = function (path) {
  return DAM.ASSETS_API_PATH + encodeURI(utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path));
};

DAMShare.prototype.buildContentDamUrl = function (path) {
  return this.buildUrlRoot() + this.buildContentDamPath(path);
};

DAMShare.prototype.buildContentDamPath = function (path) {
  return DAM.DAM_ROOT_PATH + encodeURI(utils.normalizeSMBFileName(utils.stripParentPath(this.path, this.contextPath + DAM.DAM_ROOT_PATH) + path));
};

DAMShare.prototype.buildCreateAssetPath = function (path) {
  var assetPath = this.buildContentDamUrl(path);
  if (assetPath.charAt(assetPath.length - 1) == '/') {
    assetPath = assetPath.substr(0, assetPath.length - 1);
  }
  return assetPath + '.createasset.html';
};

DAMShare.prototype.buildWcmCommandUrl = function () {
  return this.buildUrlRoot() + '/bin/wcmcommand';
};

DAMShare.prototype.fetchContent = function (tree, path, deep, cb) {
  var logger = log;
  if (tree) {
    log = tree.getLogger();
  }
  var self = this;
  if (path === Path.sep) {
    path = '';
  }
  var action = JCR.ACTION_FOLDERLIST;
  if (!deep) {
    action = JCR.ACTION_INFO;
  }
  var options = {headers: {}};
  options.headers[JCR.ACTION_HEADER] = action;
  var url = this.buildContentUrl(path, deep ? 1 : 0)
      + '?limit=9999&showProperty=jcr:created&showProperty=jcr:lastModified&showProperty=asset:size&showProperty=asset:readonly&showProperty=cq:drivelock';
  var opts = this.applyRequestDefaults(tree, options, url);
  webutils.submitRequest(opts, function (err, resp, body) {
    if (err) {
      cb(err);
    } else if (resp.statusCode === 200) {
      // succeeded
      var parsed;
      try {
        parsed = JSON.parse(body);
      } catch (parseError) {
        // unexpected format, return null
        logger.error('unexpected JSON format from api', parseError);
        cb(null, null);
        return;
      }
      cb(null, parsed);
    } else if (resp.statusCode === 404) {
      // not found, return null
      cb(null, null);
    } else {
      // failed
      cb(self.method + ' ' + self.href + ' [' + resp.statusCode + '] ' + body || '');
    }
  });
};

DAMShare.prototype.createTreeInstance = function (content, tempFilesTree) {
  return new DAMTreeConnection(this, content, tempFilesTree);
};

DAMShare.prototype.applyCreateFileResourceRequestOptions = function (options) {
  options['method'] = 'POST';
  return options;
};

DAMShare.prototype.applyCreateDirectoryResourceRequestOptions = function (options) {
  options['method'] = 'POST';
  options['headers'] = options.headers || {};
  options.headers['Content-Type'] = 'application/json; charset=utf-8'
  return options;
};

DAMShare.prototype.applyRenameResourceRequestOptions = function (newName, options) {
  options['headers'] = options.headers || {};
  options.headers['X-Destination'] = this.buildResourcePath(newName);
  options.headers['X-Depth'] = 'infinity';
  options.headers['X-Overwrite'] = 'F';
  return options;
};

function _doChunkUpload(tree, remotePath, localPath, replace, cb) {
  var logger = tree.getLogger();
  var self = this;
  var method = replace ? 'PUT' : 'POST'; // used for sync event data only

  logger.info('beginning sync of file %s', remotePath);

  fs.stat(localPath, function (err, stats) {
    if (err) {
      cb(SMBError.fromSystemError(err, 'unable to stat file ' + localPath));
      return;
    }
    self.emitSyncFileStart(remotePath, method);

    var chunkSizeFixed = self.config.chunkUploadSize;
    if (!chunkSizeFixed) {
      chunkSizeFixed = 10; // default to 10 MB
    }
    chunkSizeFixed *= (1024 * 1024);
    var totalSize = stats.size;
    var chunkOffset = 0;

    var options = self.applyRequestDefaults(tree, {
      url: self.buildCreateAssetPath(utils.getParentPath(remotePath)),
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data',
        'x-chunked-content-type': utils.lookupMimeType(remotePath),
        'x-chunked-total-size': totalSize
      }
    });
    options.headers[JCR.ACTION_HEADER] = JCR.ACTION_CREATEFILE;

    async.whilst(function () { return chunkOffset < totalSize; }, function (whileCb) {
      if (chunkOffset > 0) {
        // only include custom chunk info on first chunk request
        delete options.headers['x-chunked-content-type'];
        delete options.headers['x-chunked-total-size'];
      }
      var req = webutils.submitRequest(options, function (err, resp) {
        self.unregisterUploadRequest(remotePath);
        if (err) {
          whileCb(SMBError.fromSystemError(err, 'unexpected error in request while uploading'));
        } else if (resp.statusCode == 423) {
          logger.debug('path [%s] received locked status, indicating file is checked out', remotePath);
          whileCb(new SMBError(ntstatus.STATUS_ACCESS_DENIED, 'Asset is checked out by another user'));
        } else if (resp.statusCode != 200 && resp.statusCode != 201) {
          logger.debug('received response with invalid status code %d', resp.statusCode);
          whileCb(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'unexpected status code: ' + resp.statusCode));
        } else {
          logger.debug('path [%s] chunk completed', remotePath);
          whileCb();
        }
      });
      self.registerUploadRequest(remotePath, req);
      req.on('abort', function () {
        logger.info('upload of path %s was aborted', remotePath);
        var error = new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'upload was aborted');
        error.aborted = true;
        whileCb({error: error, ignoreEmit: true});
      });
      var form = req.form();
      if(replace) {
        logger.debug('Updating the file %s, Use post for CreateAssetServelet', remotePath);
        form.append('replaceAsset','true');
      }
      var chunkSize = chunkOffset + chunkSizeFixed < totalSize ? chunkSizeFixed : totalSize - chunkOffset;
      logger.debug('Uploading chunks to the file %s of size %s Chunk curent offset %s chunksize %s', remotePath, totalSize, chunkOffset, chunkSize);
      var read = fs.createReadStream(localPath, {'start':chunkOffset, 'end':chunkSize+chunkOffset-1});
      read.on('error', function (err) {
        self.unregisterUploadRequest(remotePath);
        whileCb(SMBError.fromSystemError(err), 'unexpected error reading file to upload');
      });
      /* if filesize is less than the chunk, upload file at once*/
      if(chunkSizeFixed < totalSize) {
        form.append('file@Offset', chunkOffset);
      }
      form.append('chunk@Length', chunkSize);
      form.append('file@Length', totalSize);
      if(chunkOffset >= totalSize) {
        form.append('file@Completed', 'true');
      }
      form.append('file', read);
      webutils.monitorTransferProgress(read, remotePath, totalSize, function (progress) {
        /* Add the chunk offset, thats what is already uploaded*/
        progress.read = progress.read + chunkOffset - chunkSize;
        logger.debug('%s: read %d of %d bytes, upload %d percent complete, rate of %d bytes/sec', remotePath, progress.read, totalSize, Math.round(progress.read / totalSize * 100), progress.rate);
        self.emitSyncFileProgress(progress);
      });
      chunkOffset += chunkSize;
    }, function (err) {
      if (err) {
        var doEmit = true;
        if (err.error) {
          doEmit = !(err.ignoreEmit);
          err = err.error;
        }
        if (doEmit) {
          logger.info('encountered handled error while attempting to sync file %s', remotePath, err);
          self.emitSyncFileError(remotePath, method, err);
        }
        cb(err);
      } else {
        logger.info('finished sync of file %s', remotePath);
        self.emitSyncFileEnd(remotePath, method);
        self.invalidateContentCache(tree, utils.getParentPath(remotePath), true);
        cb();
      }
    });
  });
}

function checkDotFile(tree, path, method, cb) {
  var logger = tree.getLogger();
  if (path.match(/\/\./g)) {
    logger.warn('%s: attempt to %s path containing names beginning with a period', path, method);
    this.emitSyncFileError(path, method, 'files containing names beginning with a period are forbidden: ' + path);
    cb(new SMBError(ntstatus.STATUS_NOT_SUPPORTED, 'files containing names beginning with a period are forbidden'));
    return true;
  }
  return false;
}

DAMShare.prototype.updateResource = function (tree, remotePath, localPath, cb) {
  if (!checkDotFile.call(this, tree, remotePath, 'PUT', cb)) {
    if (localPath) {
      _doChunkUpload.call(this, tree, remotePath, localPath, true, cb);
    } else {
      JCRShare.prototype.updateResource.call(this, tree, remotePath, localPath, cb);
    }
  }
};

DAMShare.prototype.createFileResource = function (tree, remotePath, localPath, cb) {
  if (!checkDotFile.call(this, tree, remotePath, 'POST', cb)) {
    if (localPath) {
      _doChunkUpload.call(this, tree, remotePath, localPath, false, cb);
    } else {
      JCRShare.prototype.createFileResource.call(this, tree, remotePath, localPath, cb);
    }
  }
};

DAMShare.prototype.deleteResource = function (tree, path, isFile, cb) {
  var self = this;
  var logger = tree.getLogger();

  function isCheckedOut(callback) {
    if (isFile) {
      self.isCheckedOut(tree, path, function (err, checkedOut) {
        if (err) {
          callback(err);
        } else {
          callback(null, checkedOut);
        }
      });
    } else {
      callback(null, false);
    }
  }

  function sendCallback(err) {
    if (err) {
      if (isFile) {
        self.emitSyncFileError(path, 'DELETE', err);
      }
      cb(err);
      return;
    } else if (isFile) {
      self.emitSyncFileEnd(path, 'DELETE');
    }
    cb();
  }

  if (!checkDotFile.call(this, tree, path, 'DELETE', cb)) {
    isCheckedOut(function (err, isCheckedOut) {
      if (err) {
        sendCallback(SMBError.fromSystemError(err, 'unable to determine checked out status of path'));
        return;
      } else if (isCheckedOut) {
        sendCallback(new SMBError(ntstatus.STATUS_ACCESS_DENIED, 'cannot delete file because it is checked out'));
        return;
      }
      var options = self.applyRequestDefaults(tree, {
        url: self.buildWcmCommandUrl(),
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        }
      });
      options.headers[JCR.ACTION_HEADER] = JCR.ACTION_DELETE;

      if (isFile) {
        self.emitSyncFileStart(path, 'DELETE');
      }

      var req = webutils.submitRequest(options, function (err, res, body) {
        if (err) {
          logger.error('failed to delete %s', path, err);
          sendCallback(SMBError.fromSystemError(err, 'unable to delete file due to unexpected error'));
        } else if (res.statusCode != 200) {
          sendCallback(new SMBError(ntstatus.STATUS_UNSUCCESSFUL, 'cannot delete file due to ' + res.statusCode + ' response code'));
        } else {
          // succeeded
          // invalidate cache
          self.invalidateContentCache(tree, path, false);
          sendCallback();
        }
      });

      var form = req.form();
      form.append('path', self.buildContentDamPath(path));
      form.append('cmd', 'deletePage');
      form.append('force', 'true');
      form.append('_charset_', 'utf-8');
    });
  }
};

/**
 * Determines if a path has been checked out by another user or not.
 * @param {Tree} tree Will be used for logging.
 * @param {String} path Server path of a file.
 * @param {Function} cb Invoked with the result of the operation.
 * @param {Error} cb.err Truthy if there was an error.
 * @param {Boolean} cb.checkedOut True if the path is checked out, false otherwise.
 */
DAMShare.prototype.isCheckedOut = function (tree, path, cb) {
  this.getContent(tree, path, false, function (err, content) {
    if (err) {
      cb(err);
      return;
    }

    if (!content) {
      cb(null, false);
      return;
    }

    var checkedOut = false;
    if (content.properties) {
      if (content.properties['cq:drivelock']) {
        checkedOut = true;
      }
    }
    cb(null, checkedOut);
  });
};

//--------------------------------------------------------------------< Share >

/**
 * Return a flag indicating whether this is a named pipe share.
 *
 * @return {Boolean} <code>true</code> if this is a named pipe share;
 *         <code>false</code> otherwise, i.e. if it is a disk share.
 */
DAMShare.prototype.isNamedPipe = function () {
  // call base class method
  return JCRShare.prototype.isNamedPipe.call(this);
};

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {TreeConnection} cb.tree connected tree
 */
DAMShare.prototype.connect = function (session, shareLevelPassword, cb) {
  // call base class method
  return JCRShare.prototype.connect.call(this, session, shareLevelPassword, cb);
};

module.exports = DAMShare;
