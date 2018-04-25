/*
 *  Copyright 2016 Adobe Systems Incorporated. All rights reserved.
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

var unorm = require('unorm');

var Share = require('../../spi/share');
var RQTreeConnection = require('./treeconnection');
var RQRemoteShare = require('./remoteshare');
var lock = require('../../lock');

/**
 * Creates an instance of RQShare.
 *
 * @constructor
 * @this {RQShare}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var RQShare = function (name, config) {
  if (!(this instanceof RQShare)) {
    return new RQShare(name, config);
  }
  var self = this;
  this.config = config || {};
  this.listCache = {};
  this.contentCacheTTL = typeof config.contentCacheTTL === 'number' ? config.contentCacheTTL : 30000; // default: 30s

  this.remote = new RQRemoteShare(name, config);
  this.downloadingFiles = {};

  self.remote.on('shareEvent', function (data) {
    self.emit('shareEvent', data);
  });

  Share.call(this, name, config);
};

// the RQShare prototype inherits from Share
util.inherits(RQShare, Share);

RQShare.prototype.getLocalPrefix = function () {
  return this.config.local.path;
};

RQShare.prototype.getRemotePrefix = function () {
  return this.buildResourceUrl('');
};

RQShare.prototype.getRemoteContentUrl = function () {
  return this.remote.buildContentPath('');
};

/**
 * Retrieves a value indicating whether or not a file is downloading.
 * @param {string} path The path to the file.
 * @return {boolean} TRUE if the file is currently downloading, false if not.
 */
RQShare.prototype.isDownloading = function (tree, path) {
  if (!tree.isTempFileName(path)) {
    return this.downloadingFiles[path] ? true : false;
  } else {
    // temp files are never downloading
    return false;
  }
};

/**
 * Sets a given file's status to downloading.
 * @param {string} path Path to the file.
 * @param {boolean} isDownloading TRUE if the file is downloading, FALSE if it is not.
 */
RQShare.prototype.setDownloading = function (tree, path, isDownloading) {
  this.downloadingFiles[path] = isDownloading;
};

RQShare.prototype.invalidateContentCache = function (tree, path, deep) {
  var rqlog = tree.getRqLogger();
  rqlog.debug('RQShare.invalidateContentCache %s', path);
  if (this.remote.invalidateContentCache) {
    this.remote.invalidateContentCache(tree, path, deep);
  }
  this.listCache[path] = undefined;
};

RQShare.prototype.getListCache = function (path, tree, cb) {
  var rqlog = tree.getRqLogger();
  if (this.listCache[path]) {
    var now = new Date().getTime();

    if (now - this.listCache[path].timestamp > this.contentCacheTTL) {
      // cache is expired
      rqlog.debug('RQShare.getListCache cache expired %s', path);
      this.listCache[path] = undefined;
      cb();
    } else {
      // cache is valid
      var cache = this.listCache[path].files;
      var addFile = function (index, files) {
        if (index < cache.length) {
          tree.open(cache[index], function (err, rqFile) {
            if (err) {
              cb(err);
            } else {
              files.push(rqFile);
              addFile(index + 1, files);
            }
          });
        } else {
          cb(null, files);
        }
      };
      addFile(0, []);
    }
  } else {
    cb();
  }
};

RQShare.prototype.cacheList = function (path, files) {
  var names = [];
  for (var i = 0; i < files.length; i++) {
    names.push(files[i].getPath());
  }
  this.listCache[path] = {timestamp: new Date().getTime(), files: names};
};

RQShare.prototype.buildResourceUrl = function (path) {
  return this.remote.buildResourceUrl(path);
};

RQShare.prototype.fetchResource = function (context, path, cb) {
  this.remote.fetchResource(context, path, cb);
};

RQShare.prototype.resourceExists = function (tree, path, cb) {
  this.remote.resourceExists(tree, path, cb);
};

RQShare.prototype.applyRequestDefaults = function(tree, opts, url) {
  return this.remote.applyRequestDefaults(tree, opts, url);
};

RQShare.prototype.createTree = function (remoteTree, config) {
  return new RQTreeConnection(this, remoteTree, config);
};

RQShare.prototype.emitSyncConflict = function (fileName) {
  this.emitShareEvent('syncconflict', { path: fileName });
};

function _cacheFile(filePath, localTree, remoteTree, refresh, cb) {
  var logger = localTree.getLogger();
  logger.debug('local file %s does not exist. fetching from remote', filePath);
  localTree.download(remoteTree, filePath, {refresh: refresh}, cb);
}

/**
 * Determines if a given file has been cached and needs to be updated.
 * @param {RQFile} file The file to check.
 * @param {Function} cb Will be invoked when the operation is complete.
 * @param {Object} cb.err Will be truthy if there were errors during the operation.
 * @param {Boolean} cb.needsUpdate Will be true if the file needs to be updated, otherwise false.
 * @private
 */
function _cacheNeedsUpdate(rqTree, remoteTree, localFile, cb) {
  var logger = rqTree.getLogger();
  var rqlog = rqTree.getRqLogger();
  var filePath = localFile.getPath();

  function closeFile(file, callback) {
    file.close(function (err) {
      if (err) {
        logger.error('unexpected error while trying to close remote file after checking whether cache needs to be updated', err);
      }
      callback();
    });
  };

  if (localFile.isCreatedLocally()) {
    logger.debug('file %s was created locally, no need to update', filePath);
    cb(null, false);
  } else {
    logger.debug('file %s was cached from remote, check to see if it needs to be updated', filePath);
    rqlog.debug('RQFile.cacheFile.remote.open %s', filePath);
    remoteTree.open(rqTree.remoteEncodePath(filePath), function (err, remoteFile) {
      if (err) {
        logger.info('error while attempting to open cached remote file, not attemting to update', err);
        cb(null, false);
      } else {
        var remoteModified = remoteFile.lastModified();
        closeFile(remoteFile, function () {
          logger.debug('%s comparing cached remote modified (%d) with current remote modified (%d)', filePath, localFile.getDownloadedRemoteModifiedDate(), remoteModified);
          cb(null, (localFile.getDownloadedRemoteModifiedDate() != remoteModified));
        });
      }
    });
  }
};

/**
 * Updates a locally cached file if it can be deleted.
 * @param {RQTree} rqTree The tree initiating the operation.
 * @param {RQLocalTree} localTree The tree to use for caching.
 * @param {RQRemoteTree} remoteTree The tree to use to retrieve the file.
 * @param {RQLocalFile} localFile The existing file that should be replaced.
 * @param {Function} cb Will be invoked when the operation is complete.
 * @param {Object} cb.err Will be truthy if there were errors.
 * @param {RQLocalFile} cb.file If not null, the newly cached file. If null, the file could not be updated.
 * @private
 */
function _updateCache(rqTree, localTree, remoteTree, localFile, cb) {
  var logger = rqTree.getLogger();
  var self = this;
  var filePath = localFile.getPath();
  localFile.canDelete(function (err, canDelete) {
    if (err) {
      cb(err);
    } else if (!canDelete) {
      logger.debug('file %s cannot be safely deleted. check to see if it is in the queue', filePath);
      rqTree.queueDataExists(filePath, function (err, exists) {
        if (err) {
          cb(err);
        } else {
          if (!exists) {
            logger.info('file %s is in conflict', filePath);
            self.emitSyncConflict(filePath);
          }
          cb();
        }
      });
    } else {
      logger.info('file %s is being re-cached', filePath);
      _cacheFile.call(self, filePath, localTree, remoteTree, true, function (err, file) {
        if (err) {
          logger.info('encountered error while attempting to re-cache file %s. keeping previous file', filePath);
          cb();
        } else {
          cb(null, file);
        }
      });
    }
  });
}

function _doCacheFile(rqFile, writeLock, cb) {
  var logger = rqFile.getLogger();
  var rqlog = rqFile.getRqLogger();

  var self = this;
  var rqTree = rqFile.tree;
  var localTree = rqTree.local;
  var remoteTree = rqTree.remote;
  var filePath = rqFile.filePath;
  var context = rqFile.getContext();

  rqlog.debug('RQShare.cacheFile %s', filePath);

  function closeFile(file, callback) {
    file.close(function (err) {
      if (err) {
        logger.error('unexpected error while closing file when attempting to cache locally', err);
      }
      callback();
    });
  }

  function invokeCallback(release, err, file, callback) {
    release();
    callback(err, file);
  }

  function getLock(callback) {
    if (writeLock) {
      lock.writeLock(context, filePath, callback);
    } else {
      lock.readLock(context, filePath, callback);
    }
  }

  if (rqTree.isTempFileName(filePath)) {
    logger.debug('%s is a temporary file, do not attempt to cache it', filePath);
    cb();
  } else {
    getLock(function (release) {
      localTree.exists(filePath, function (err, exists) {
        if (err) {
          invokeCallback(release, err, undefined, cb);
        } else if (exists) {
          localTree.open(filePath, function (err, localFile) {
            if (err) {
              invokeCallback(release, err, undefined, cb);
            } else {
              // file has already been cached. check to see if it needs to be updated
              _cacheNeedsUpdate.call(self, rqTree, remoteTree, localFile, function (err, needsUpdate) {
                if (err) {
                  closeFile(localFile, function () {
                    invokeCallback(release, err, undefined, cb);
                  });
                } else if (needsUpdate) {
                  // at this point we've determined that the file needs to be downloaded. however, it's possible that
                  // another command started the download during the "exists" check. For that reason, recurse this
                  // function to get a write lock, then redo all checks within the lock. This way we can ensure a
                  // properly locked state without needing to block every operation.
                  if (!writeLock) {
                    logger.debug('file %s needs to be re-cached. retrieving write lock', filePath);
                    release();
                    _doCacheFile.call(self, rqFile, true, cb);
                  } else {
                    logger.debug('file %s needs to be re-cached and have write lock. downloading file.', filePath);
                    _updateCache.call(self, rqTree, localTree, remoteTree, localFile, function (err, file) {
                      closeFile(localFile, function () {
                        invokeCallback(release, err, file, cb);
                      });
                    });
                  }
                } else {
                  // file is already cached but no update is needed
                  logger.info('%s using cached file', filePath);

                  invokeCallback(release, undefined, localFile, cb);
                }
              });
            }
          });
        } else {
          // another point where the file needs to be downloaded. recurse and re-check to ensure a proper lock.
          if (!writeLock) {
            logger.debug('file %s needs to be cached. retrieving write lock', filePath);
            release();
            _doCacheFile.call(self, rqFile, true, cb);
          } else {
            logger.debug('file %s needs to be cached and have write lock. downloading file.', filePath);
            _cacheFile.call(self, filePath, localTree, remoteTree, false, function (err, file) {
              invokeCallback(release, err, file, cb);
            });
          }
        }
      });
    });
  }
}

/**
 * If necessary, caches a remote file locally for use in cached operations.
 * @param {Function} cb callback called after caching is complete
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file If not null, the newly cached File instance. If null, no caching was done.
 */
RQShare.prototype.cacheFile = function (rqFile, cb) {
  _doCacheFile.call(this, rqFile, false, cb);
};

//--------------------------------------------------------------------< Share >

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Tree} cb.tree connected tree
 */
RQShare.prototype.connect = function (session, shareLevelPassword, cb) {
  var self = this;
  self.remote.connect(session, shareLevelPassword, function (err, remoteTree) {
    if (err) {
      cb(err);
    } else {
      cb(null, self.createTree(remoteTree, self.config));
    }
  });
};

RQShare.prototype.onServerEvent = function (context, eventName, data) {
  data['context'] = context;
  this.emit(eventName, data);
};

/**
 * Encodes a path in a unicode format acceptable for sending to the remote host.
 * @param {String} path The path to be encoded.
 * @returns {String} The encoded path.
 */
RQShare.prototype.remoteEncodePath = function (path) {
  if (!this.config.noUnicodeNormalize) {
    return unorm.nfkc(path);
  } else {
    return path;
  }
};

module.exports = RQShare;
