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

var async = require('async');
var Path = require('path');

var ntstatus = require('../ntstatus');
var SMBError = require('../smberror');
var utils = require('../utils');

/**
 * Creates an instance of Tree.
 *
 * @constructor
 * @this {Tree}
 */
var Tree = function (treeConnection, context) {
  if (!(this instanceof Tree)) {
    return new Tree(treeConnection, context);
  }
  this.treeConnection = treeConnection;
  this.context = context;
  this.config = treeConnection.config;
};

/**
 * Retrieves the configuration of the share.
 * @returns {Object} An object containing configuration information.
 */
Tree.prototype.getConfig = function () {
  return this.config;
};

/**
 * Retrieves the tree's context instance.
 * @returns {SMBContext}
 */
Tree.prototype.getContext = function () {
  return this.context;
};

/**
 * Retrieves the arbitrary request ID of the tree.
 * @returns {string}
 */
Tree.prototype.getRequestId = function () {
  return this.context.getRequestId();
};

/**
 * Retrieves the logger instance to use for request-specific messages.
 * @returns {Object}
 */
Tree.prototype.getRequestLogger = function () {
  return this.context.request();
};

/**
 * Retrieves the logger instance that should be used for logging messages.
 * @returns {Object}
 */
Tree.prototype.getLogger = function () {
  return this.context.spi();
};

/**
 * Test whether or not the specified file exists.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.exists true if the file exists; false otherwise
 */
Tree.prototype.exists = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Open an existing file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file opened file
 */
Tree.prototype.open = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * List entries, matching a specified pattern.
 *
 * @param {String} pattern pattern
 * @param {Function} cb callback called with an array of matching files
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File[]} cb.files array of matching files
 */
Tree.prototype.list = function (pattern, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Create a new file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created file
 */
Tree.prototype.createFile = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Create a new directory.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created directory
 */
Tree.prototype.createDirectory = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Delete a file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.delete = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Delete a directory. It must be empty in order to be deleted.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.deleteDirectory = function (name, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Rename a file or directory.
 *
 * @param {String} oldName old name
 * @param {String} newName new name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.rename = function (oldName, newName, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Refresh a specific folder.
 *
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
Tree.prototype.refresh = function (folderPath, deep, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Normalizes a unicode string in order to avoid issues related to different code points.
 * @param {String} str The value to be normalized.
 * @returns {String} A normalized string value.
 */
Tree.prototype.unicodeNormalize = function (str) {
  if (!this.config.noUnicodeNormalize) {
    return utils.unicodeNormalize(str);
  } else {
    return str;
  }
};

/**
 * Determines if two strings are equal based on their normalized unicode values.
 * @param {String} str1 The first value to be compared.
 * @param {String} str2 The second value to be compared.
 * @returns {Boolean} true if the two values are equal, otherwise false.
 */
Tree.prototype.unicodeEquals = function (str1, str2) {
  if (!this.config.noUnicodeNormalize) {
    return utils.unicodeEquals(str1, str2);
  } else {
    return str1 == str2;
  }
};

/**
 * Clears the tree's cache. Default implementation does nothing.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {string|Error} cb.err Will be truthy if there were errors during the operation.
 */
Tree.prototype.clearCache = function (cb) {
  cb();
};

/**
 * Recursively traverses a directory path in the tree, using the Tree's methods.
 * @param {String} startPath The path where the traversal should start.
 * @param {Function} dirCb Invoked when all the files in a given directory have been traversed, but not necessarily as
 *   soon as the directory traversal is complete. However, a given directory is guaranteed to come before its parent.
 * @param {String} dirCb.parent The name of the directory's parent directory, or empty if the directory is the root of
 *   the traversal.
 * @param {String} dirCb.directory The path of the directory that was traversed.
 * @param {Function} dirCb.callback Should be invoked with an optional error parameter when handling of the directory
 *   is complete.
 * @param {Function} fileCb Will be invoked when a file is traversed.
 * @param {String} fileCb.directory Path of the file's directory.
 * @param {File} fileCb.file The file that was traversed.
 * @param {Function} fileCb.callback Should be invoked with an optional error parameter when handling of the file
 *   is complete.
 * @param {Function} cb Will be invoked once all files and directories have been traversed.
 * @param {Error} cb.err Will be truthy if there was an error preventing the traversal from completing. Errors provided
 *   in dirCb or fileCb will not force the process to stop.
 */
Tree.prototype.traverseDirectory = function (startPath, dirCb, fileCb, cb) {
  var tree = this;
  var logger = tree.getLogger();
  var processDirs = [{
    name: startPath,
    parent: ''
  }];

  var index = 0;
  async.whilst(function () {
    return index >= 0;
  }, function (whilstCb) {
    var dirName = processDirs[index].name;
    var parent = processDirs[index--].parent;
    logger.debug('processing directory %s', dirName);
    tree.local.list(Path.join(dirName, '/*'), function (err, items) {
      if (err) {
        whilstCb(err);
      } else {
        logger.debug('found %d items in directory %s', items.length, dirName);
        async.eachSeries(items, function (item, eachCb) {
          if (item.isDirectory()) {
            logger.debug('%s is a directory, adding to dir queue', item.getPath());
            processDirs.splice(0, 0, {
              name: item.getPath(),
              parent: dirName
            });
            index++;
            eachCb();
          } else {
            fileCb(dirName, item, function (err) {
              eachCb();
            });
          }
        }, function (err) {
          if (err) {
            whilstCb(err);
          } else {
            whilstCb();
          }
        });
      }
    });
  }, function (err) {
    if (err) {
      cb(err);
    } else {
      async.eachSeries(processDirs, function (dir, eachCb) {
        dirCb(dir.parent, dir.name, function (err) {
          eachCb();
        });
      }, cb);
    }
  });
};

module.exports = Tree;
