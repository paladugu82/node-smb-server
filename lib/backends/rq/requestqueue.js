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

var Path = require('path');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var async = require('async');

var rqlog = require('../../logging').getLogger('rq');
var Datastore = require('nedb');

var utils = require('../../utils');
var consts = require('./common.js');

/**
 * Creates a new RequestQueue instance.
 * @constructor
 */
function RequestQueue(options) {
  if (!(this instanceof RequestQueue)) {
    return new RequestQueue(options);
  }

  EventEmitter.call(this);
  this.db = new Datastore({filename: Path.join(options.path, consts.REQUEST_DB), autoload: true});
}

util.inherits(RequestQueue, EventEmitter);

/**
 * Retrieves all requests that have been queued for a given parent directory.
 * @param {String} path The full to the directory to check.
 * @param {Function} callback Function to call with results of get operation.
 * @param {String|Error} callback.err Error that occurred (will be undefined on success)
 * @param {Object} callback.requestLookup object whose keys are names and values are methods
 */
RequestQueue.prototype.getRequests = function (context, path, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.getRequests %s', path);
  var self = this;
  self.db.find({path: path}, function (err, docs) {
    if (err) {
      log.warn('unexpected error while attempting to query request queue: ' + err);
      callback(err);
    } else {
      log.debug('getCreateRequests: query for path %s returned %s records', path, docs.length);

      var requestLookup = {};
      for (var i = 0; i < docs.length; i++) {
        requestLookup[docs[i].name] = docs[i].method;
      }

      callback(undefined, requestLookup);
    }
  });
};

/**
 * Retrieves all requests that have been queued.
 * @param {Function} callback Function to call with results of get operation.
 * @param {String|Error} callback.err Error that occurred (will be falsy on success).
 * @param {Array} callback.requests Array of objects representing the raw queued requests.
 */
RequestQueue.prototype.getAllRequests = function (context, callback) {
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.getActiveRequests');
  this.db.find({}).sort({timestamp: -1}).exec(callback);
};

/**
 * Retrieves a value indicating whether or not a given item exists in the queue.
 * @param {String} path The path of the item to check.
 * @param {String} name The name of the item to check.
 * @param {Function} callback Will be invoked with information about the existence of the item.
 * @param {String|Error} callback.err Will be truthy if the operation failed.
 * @param {Boolean} callback.exists Will be true if the item exists in the queue, otherwise will be false.
 */
RequestQueue.prototype.exists = function (context, path, name, callback) {
  this.getRequest(context, path, name, function (err, doc) {
    if (err) {
      callback(err);
    } else {
      callback(null, (doc ? true : false));
    }
  });
};

/**
 * Retrieves the queued request for a given file. Note that if the request does not exist, the provided value will
 * be null.
 * @param {SMBContext} context Will be used for logging.
 * @param {String} path Path to the directory of the item to retrieve.
 * @param {String} name Name of the item to retrieve.
 * @param {Function} callback Will be invoked with the result.
 * @param {String|Error} callback.err Will be truthy if the operation failed.
 * @param {Object} callback.request Request information for the given path.
 */
RequestQueue.prototype.getRequest = function (context, path, name, callback) {
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.exists [%s] [%s]', path, name);
  var self = this;
  self.db.findOne({$and: [{path: path}, {name: name}]}, function (err, doc) {
    if (err) {
      callback(err);
    } else {
      callback(null, doc);
    }
  });
};

/**
 * Removes all requests that exceeded the maximum number of retries.
 * @param {Number} maxRetries The number of retries that a request should exceed before being purged.
 * @param {Function} callback Will be invoked when requests have been purged.
 * @param {String|Error} callback.err Will be truthy if the purge encountered errors.
 * @param {Array} callback.paths An array of file paths whose requests were purged.
 */
RequestQueue.prototype.purgeFailedRequests = function (maxRetries, callback) {
  rqlog.debug('RequestQueue.purgeFailedRequests [%d]', maxRetries);
  var self = this;
  self.db.find({retries: {$gte: maxRetries}}, function (err, docs) {
    var paths = [];
    var purgeRequest = function (index) {
      if (index < docs.length) {
        paths.push(Path.join(docs[index].path, docs[index].name));
        self.db.remove({_id: docs[index]._id}, {}, function (err) {
          if (err) {
            callback(err);
          } else {
            purgeRequest(index + 1);
          }
        });
      } else {
        callback(null, paths);
      }
    };
    purgeRequest(0);
  });
};

/**
 * Increments the number of retry counts for a given request by 1.
 * @param {String} path The path of the request to be updated.
 * @param {String} name The name of the file whose request should be updated.
 * @param {Number} delay
 * @param {Function} callback Will be called after the update.
 * @param {String|Error} callback.err Will be truthy if there were errors during the update.
 */
RequestQueue.prototype.incrementRetryCount = function (context, path, name, delay, callback) {
  var rqlog = context.rq();
  var log = context.spi();
  log.info('incrementing retry count for %s', Path.join(path, name));
  rqlog.debug('RequestQueue.incrementRetryCount [%s] [%s] [%d]', path, name, delay);
  var newTime = new Date().getTime() + delay;
  this.db.update({$and: [{path: path}, {name: name}]}, {
    $inc: {retries: 1},
    $set: {timestamp: newTime}
  }, function (err, numAffected) {
    if (err) {
      callback(err);
    } else if (numAffected != 1) {
      callback('unexpected number of requests had retry count updated: ' + numAffected);
    } else {
      callback();
    }
  });
};

function _emitEvent(context, eventName, path, data) {
  data = data || {};
  if (context) {
    data['context'] = context;
  }
  if (path) {
    data['path'] = path;
  }
  this.emit(eventName, data);
}

function _emitRequestChanged(path, method, timestamp, isRemoved) {
  var data = {};
  if (isRemoved) {
    data['removed'] = true;
  } else if (method) {
    data['method'] = method;
    data['timestamp'] = timestamp;
  }
  _emitEvent.call(this, false, 'requestchanged', path, data);
}

/**
 * Removes the request for a given local path from the queue.
 * @param {String} path The path of the request to be removed.
 * @param {String} name The name of the file whose request should be removed.
 * @param {Function} callback Function that will be called when removal is complete.
 * @param {String|Error} callback.err If non-null, indicates that an error occurred.
 */
RequestQueue.prototype.removeRequest = function (context, path, name, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.removeRequest [%s] [%s]', path, name);
  var self = this;
  this.db.remove({path: path, name: name}, {}, function (err, numRemoved) {
    if (err) {
      callback(err);
    } else if (numRemoved != 1) {
      callback('unexpected number of requests removed ' + numRemoved);
    } else {
      _emitEvent.call(self, context, 'itemupdated', Path.join(path, name));
      _emitRequestChanged.call(self, Path.join(path, name), null, null, true);
      log.debug('emitting queuechanged event due to removed request');
      _emitEvent.call(self, context, 'queuechanged');
      callback();
    }
  });
};

/**
 * Completes the request for a given local path by removing it from the queue.
 * @param {String} path The path of the request to be completed.
 * @param {String} name The name of the file whose request should be completed.
 * @param {Function} callback Function that will be called when finished.
 * @param {String|Error} callback.err If non-null, indicates that an error occurred.
 */
RequestQueue.prototype.completeRequest = function (context, path, name, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.completeRequest [%s] [%s]', path, name);
  var self = this;
  log.info('completing request for path %s', Path.join(path, name));
  this.db.remove({path: path, name: name}, {}, function (err, numRemoved) {
    if (err) {
      callback(err);
    } else if (numRemoved != 1) {
      callback('unexpected number of requests completed ' + numRemoved);
    } else {
      callback();
    }
  });
};

/**
 * Retrieves the next request that is older than the given expiration.
 * @param {Number} expiration The next request older than this number of ticks will be retrieved.
 * @param {Number} maxRetries Requests that have attempted to process this many times will be excluded.
 * @param {Function} callback Will be invoked when the request is retrieved.
 * @param {String|Error} callback.err Will be truthy if there were errors retrieving the request.
 * @param {Object} callback.request The retrieved request, or falsy if there were none.
 */
RequestQueue.prototype.getProcessRequest = function (context, expiration, maxRetries, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.getProcessRequest [%d] [%d]', expiration, maxRetries);
  var self = this;
  var expired = Date.now() - expiration;
  log.debug('getProcessRequest: retrieving requests that are ready to be processed');
  self.db.find({$and: [{timestamp: {$lte: expired}}, {retries: {$lt: maxRetries}}]}).sort({timestamp: 1}).limit(1).exec(function (err, docs) {
    if (err) {
      callback(err);
    } else {
      if (docs.length) {
        log.debug('getProcessRequest: found a request for path [%s] name [%s] to process', docs[0].path, docs[0].name);
        callback(null, docs[0]);
      } else {
        log.debug('getProcessRequest: no requests ready to process');
        callback();
      }
    }

  });
};

/**
 * Gets the filter for retrieving all child records of a given path.
 * @param {String} path The path whose filter should be created.
 * @returns {Object} The path's filter object.
 */
RequestQueue.prototype.getFindPathFilter = function (path) {
  var subPath = path;
  if (subPath != '/') {
    subPath += '\\/';
  }
  var subReg = new RegExp('^' + subPath, 'g');
  return {$or: [{path: path}, {path: subReg}]};
};

/**
 * Given a current path, an old path, and a new path, retrieves the new full path for an item.
 * @param {String} currPath The items current path.
 * @param {String} oldPath The old portion of the path to be updated.
 * @param {String} newPath The new path to update the old path with.
 * @returns {String} The item's new path.
 */
RequestQueue.prototype.getNewPath = function (currPath, oldPath, newPath) {
  var docPath = currPath;
  docPath = docPath.substr(oldPath.length);
  docPath = newPath + docPath;
  return docPath;
};

/**
 * Updates the records with a matching path to have a different path value.
 * @param {String} oldPath The path whose records should be updated.
 * @param {String} newPath The new value to set for matching records.
 * @param {Function} callback Will be invoked upon completion.
 * @param {String|Error} callback.err Will be truthy if there was an error while updating.
 */
RequestQueue.prototype.updatePath = function (context, oldPath, newPath, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.updatePath [%s] [%s]', oldPath, newPath);
  log.info('updating all requests for path %s to use new path %s', oldPath, newPath);
  var self = this;
  self.db.find(self.getFindPathFilter(oldPath), function (err, docs) {
    if (err) {
      callback(err);
    } else {
      var newTimestamp = new Date().getTime();
      async.forEach(docs, function (doc, eachCb) {
        var newDocPath = self.getNewPath(doc.path, oldPath, newPath);
        self.db.update({_id: doc._id}, {
          $set: {
            path: newDocPath,
            timestamp: newTimestamp
          }
        }, function (err) {
          if (err) {
            eachCb(err);
            return;
          }
          _emitRequestChanged.call(self, Path.join(doc.path, doc.name), null, null, true);
          _emitRequestChanged.call(self, Path.join(newDocPath, doc.name), doc.method, newTimestamp);
          eachCb();
        });
      }, function (err) {
        if (err) {
          callback(err);
          return;
        }
        _emitEvent.call(self, context, 'pathupdated', oldPath);
        if (docs.length) {
          log.debug('emitting queuechanged event due to updated path');
          _emitEvent.call(self, context, 'queuechanged');
        }
        callback();
      });
    }
  });
};

/**
 * Removes all records whose path matches a given value.
 * @param {String} path The path whose records should be removed.
 * @param {Function} callback Will be invoked upon completion.
 * @param {String|Error} callback.err Will be truthy if there was an error while updating.
 */
RequestQueue.prototype.removePath = function (context, path, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.removePath [%s]', path);
  var self = this;
  log.info('removing all requests for path %s', path);

  var filter = self.getFindPathFilter(path);
  self.db.find(filter, function (err, docs) {
    if (err) {
      callback(err);
      return;
    }
    async.forEach(docs, function (doc, eachCb) {
      self.db.remove({_id: doc._id}, function (err) {
        if (err) {
          eachCb(err);
          return;
        }
        _emitRequestChanged.call(self, Path.join(doc.path, doc.name), null, null, true);
        eachCb();
      });
    }, function (err) {
      if (err) {
        callback(err);
        return;
      }
      log.debug('removed %d requests for path %s', docs.length, path);
      _emitEvent.call(self, context, 'pathupdated', path);
      if (docs.length) {
        log.debug('emitting queuechanged event due to removed path');

        _emitEvent.call(self, context, 'queuechanged');
      }
      callback();
    });
  });
};

/**
 * Copies all records with a given path and assigns them a new path.
 * @param {String} oldPath The path whose records should be copied.
 * @param {String} newPath The path that copied records should receive.
 * @param {Function} callback Will be invoked upon completion.
 * @param {String|Error} callback.err Will be truthy if there was an error while updating.
 */
RequestQueue.prototype.copyPath = function (context, oldPath, newPath, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  rqlog.debug('RequestQueue.copyPath [%s] [%s]', oldPath, newPath);
  var self = this;
  log.info('copying all requests from path %s to %s', oldPath, newPath);
  self.db.find(self.getFindPathFilter(oldPath), function (err, docs) {
    if (err) {
      callback(err);
    } else {
      async.eachSeries(docs, function (doc, eachCb) {
        self.queueRequest(context, {
          method: doc.method,
          path: self.getNewPath(doc.path, oldPath, newPath) + '/' + doc.name,
          localPrefix: doc.localPrefix,
          remotePrefix: doc.remotePrefix
        }, eachCb);
      }, function (err) {
        callback(err);
      });
    }
  });
};

/**
 * Queues a request for processing.
 * @param {Object} options Options for the queue request.
 * @param {String} options.method The HTTP request being queued
 * @param {String} options.path The path to the file to be queued. This path should be the portion of the file's
 *  path that is common between its local location and remote location.
 * @param {String} options.localPrefix Path prefix for the local location of the file. Concatenating this value
 *  with path should yield the full path to the local file.
 * @param {String} options.remotePrefix URL prefix for the remote target of the request. Concatenating this value
 *  with path should yield the full URL to the file.
 * @param {String} options.destPath Optional destination path for move and copy requests. Should be the portion of
 *  the file's path that is common between its local location and remote location.
 * @param {Function} callback Callback function to call once the request has been queued.
 * @param {String|Error} callback.err Any error messages that occurred.
 */
RequestQueue.prototype.queueRequest = function (context, options, callback) {
  var log = context.spi();
  var rqlog = context.rq();
  var reqMethod = options.method;
  var fullPath = options.path;
  var path = utils.getParentPath(fullPath);
  var name = utils.getPathName(fullPath);
  var localPrefix = options.localPrefix;
  var remotePrefix = options.remotePrefix;
  var destPath = null;
  var destName = null;
  var moveTarget = 'PUT';

  if (options.destPath) {
    destPath = utils.getParentPath(options.destPath);
    destName = utils.getPathName(options.destPath);
    if (options.replace) {
      moveTarget = 'POST';
    }
  }

  rqlog.debug('RequestQueue.queueRequest [%s] [%s]', reqMethod, fullPath);
  log.debug('queueRequest: %s: queuing %s method', fullPath, reqMethod);

  var self = this;
  if (fullPath.match(/\/\./g)) {
    // protect against file names that start with a period. These can cause serious issues when used with the
    // assets api, especially when deleting.
    callback('%s: paths with names beginning with a period are forbidden from being queued for requests', fullPath);
  } else {
    var remove = function (removeDoc, removeCallback) {
      log.info('removing previously queued %s request for path %s', removeDoc.method, fullPath);
      self.db.remove({_id: removeDoc._id}, {}, function (err, numRemoved) {
        if (err) {
          log.warn('queueRequest: %s: encountered error while attempting removal', fullPath, err);
          removeCallback(err);
        } else {
          log.debug('queueRequest: %s: successfully removed previously queued request', fullPath);
          removeCallback();
        }
      });
    };
    var insert = function (insertReqMethod, insertPath, insertName, insertDestPath, insertDestName, insertCallback) {
      log.info('inserting %s request for path %s', insertReqMethod, fullPath);

      var record = {
        method: insertReqMethod,
        timestamp: Date.now(),
        retries: 0,
        path: insertPath,
        name: insertName,
        localPrefix: localPrefix,
        remotePrefix: remotePrefix
      };

      if (insertDestPath) {
        record['destPath'] = insertDestPath;
        record['destName'] = insertDestName;
      }

      self.db.insert(record, function (err, newDoc) {
        if (err) {
          insertCallback(err);
        } else {
          insertCallback(null, newDoc.timestamp);
        }
      });
    };

    var processMethod = function (methodToProcess, processPath, processName, processDestPath, processDestName,
                                  processCallback) {
      self.db.findOne({$and: [{path: processPath, name: processName}]}, function (err, doc) {
        if (err) {
          log.warn('queueRequest: %s: unexpected error while retrieving existing requests', fullPath, err);
          processCallback(err);
        } else {
          log.debug('queueRequest: %s: finished querying for cached file %s', fullPath, processPath);
          if (doc !== null) {
            log.debug('queueRequest: %s: already queued for %s', fullPath, doc.method);
            var update = (doc.method == 'PUT' || doc.method == 'POST');

            // the file has already been queued. Run through a series of test to determine what should happen
            if (methodToProcess == 'DELETE') {
              // the file is being deleted. any previously queued actions should be removed.
              log.debug('queueRequest: %s: queuing for delete. removing previously queued %s', fullPath, doc.method);
              // only queue the deletion if the file isn't newly added
              remove(doc, function (err) {
                if (err) {
                  processCallback(err);
                } else if (doc.method != 'PUT') {
                  insert(methodToProcess, processPath, processName, processDestPath, processDestName, function (err, timestamp) {
                    if (err) {
                      processCallback(err);
                    } else {
                      processCallback(null, update, processPath, processName, methodToProcess, timestamp);
                    }
                  });
                } else {
                  processCallback(null, update, processPath, processName, methodToProcess, null, true);
                }
              });
            } else if (doc.method == 'PUT' || doc.method == 'POST') {
              // update timestamp
              log.debug('queueRequest: %s: updating timestamp of existing record', fullPath);
              var timestamp = new Date().getTime();
              self.db.update({_id: doc._id}, {$set: {timestamp: timestamp}}, {}, function (err) {
                if (err) {
                  processCallback(err);
                } else {
                  processCallback(null, update, processPath, processName, doc.method, timestamp);
                }
              });
            } else if (doc.method == 'DELETE') {
              // file is being re-created
              log.debug('queueRequest: %s: %s previously queued. changing to POST %s', fullPath, doc.method, processPath);

              // change to update instead
              remove(doc, function (err) {
                if (err) {
                  processCallback(err);
                } else {
                  insert('POST', processPath, processName, processDestPath, processDestName, function (err, timestamp) {
                    if (err) {
                      processCallback(err);
                    } else {
                      processCallback(null, update, processPath, processName, 'POST', timestamp);
                    }
                  });
                }
              });
            } else {
              log.warn('queueRequest: %s: unhandled method: ' + doc.method, fullPath);
              processCallback(null, update, processPath, processName);
            }
          } else {
            log.debug('queueRequest: %s: queuing originally submitted %s to %s', fullPath, methodToProcess, processPath);
            insert(methodToProcess, processPath, processName, processDestPath, processDestName, function (err, timestamp) {
              if (err) {
                processCallback(err);
              } else {
                processCallback(null, false, processPath, processName, methodToProcess, timestamp);
              }
            });
          }
        }
      });
    };

    var finishQueue = function (sendUpdate, resultPath, resultName, method, timestamp, isRemoved) {
      if (sendUpdate) {
        _emitEvent.call(self, context, 'itemupdated', Path.join(resultPath, resultName));
      }
      if (method) {
        _emitRequestChanged.call(self, Path.join(resultPath, resultName), method, timestamp, isRemoved);
      }
      log.debug('queueRequest: %s: emitting queuechanged event', fullPath);
      _emitEvent.call(self, context, 'queuechanged');
    };

    var handleResult = function (err, sendUpdate, resultPath, resultName, method, timestamp, isRemoved) {
      if (err) {
        callback(err);
      } else {
        finishQueue(sendUpdate, resultPath, resultName, method, timestamp, isRemoved);
        callback();
      }
    };

    if (reqMethod == 'COPY') {
      log.debug('queueRequest: %s: queueing for COPY. processing PUT for destination', fullPath, reqMethod);
      processMethod('PUT', destPath, destName, null, null, handleResult);
    } else if (reqMethod == 'MOVE') {
      log.debug('queueRequest: %s: queueing for MOVE. processing DELETE for source', fullPath, reqMethod);

      processMethod('DELETE', path, name, null, null, function (err, sendUpdate, resultPath, resultName, method, timestamp, isRemoved) {
        if (err) {
          callback(err);
        } else {
          finishQueue(sendUpdate, resultPath, resultName, method, timestamp, isRemoved);
          log.debug('queueRequest: %s: queueing for MOVE. processing %w for destination', fullPath, reqMethod, moveTarget);
          processMethod(moveTarget, destPath, destName, null, null, handleResult);
        }
      });
    } else {
      processMethod(reqMethod, path, name, destPath, destName, handleResult);
    }
  }
};

// export this class
module.exports = RequestQueue;
