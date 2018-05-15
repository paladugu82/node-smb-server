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
var Path = require('path');
var fs = require('fs');
var async = require('async');

var FileConnection = require('../../spi/fileconnection');
var FSFile = require('./file');
var SMBError = require('../../smberror');

/**
 * Creates an instance of FSFileConnection.
 *
 * @constructor
 * @this {FSFileConnection}
 */
var FSFileConnection = function (filePath, tree, stats) {
  if (!(this instanceof FSFileConnection)) {
    return new FSFileConnection(filePath, tree, stats);
  }

  FileConnection.call(this, filePath, tree);
  this.setStats(stats);
  this.realPath = FSFileConnection.buildRealPath(tree, filePath);
};

util.inherits(FSFileConnection, FileConnection);

/**
 * Retrieves the real, disk path to a file.
 * @param {string} tree The file's tree. The tree's config will be used to determine the local path.
 * @param {string} filePath The server's file path.
 */
FSFileConnection.buildRealPath = function (tree, filePath) {
  return tree.unicodeNormalize(Path.join(tree.share.path, filePath));
};

/**
 * Async factory method
 *
 * @param {String} filePath normalized file path
 * @param {FSTree} tree tree object
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {FSFile} cb.file FSFile instance
 */
FSFileConnection.createFileInstance = function (filePath, tree, cb) {
  var realPath = FSFileConnection.buildRealPath(tree, filePath);
  fs.stat(realPath, function (err, stats) {
    if (err) {
      cb(SMBError.fromSystemError(err, 'unable to create file due to unexpected error ' + filePath));
    } else {
      cb(null, new FSFile(new FSFileConnection(filePath, tree, stats), tree));
    }
  });
};

/**
 * If necessary, opens a file descriptor that will be used for the life of the file connection instance.
 * @param {File} file The spi file whose descriptor should be retrieved.
 * @param {function} cb Will be invoked when the operation is complete.
 * @param {SMBError} cb.error Will be truthy if there were errors during the operation.
 * @param {int} cb.fd The file's descriptor.
 */
FSFileConnection.prototype.getFileDescriptor = function (file, cb) {
  var logger = file.getLogger();
  logger.debug('[fs] getDescriptor %s', this.getFilePath());
  var self = this;

  function openCB(err, fd) {
    if (err) {
      cb(SMBError.fromSystemError(err, 'unable to get file descriptor due to unexpected error ' + self.getFilePath()));
    } else {
      self.fd = fd;
      cb(null, fd);
    }
  }

  if (this.fd) {
    cb(null, this.fd);
  } else {
    // open read-write
    fs.open(self.getRealPath(), 'r+', function (err, fd) {
      if (err && err.code === 'EACCES') {
        // open read-only
        logger.debug('[fs] getDescriptor file is read-only', self.getRealPath());
        fs.open(self.getRealPath(), 'r', openCB);
      } else {
        openCB(err, fd);
      }
    });
  }
};

/**
 * Refreshes the stats information of the underlying file.
 *
 * @param {File} The spi file requesting the operation.
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFileConnection.prototype.refreshFileStats = function (file, cb) {
  var logger = file.getLogger();
  var perflog = file.getPerfLogger();
  var self = this;
  // update stats
  perflog.debug('%s File.refreshStats.fs.stat', this.getFilePath());
  // todo use fs.fstat if there's an open file descriptor?
  fs.stat(this.getRealPath(), function (ignored, stats) {
    if (!ignored) {
      self.setStats(stats);
    } else {
      logger.warn('[fs] file.refreshStats %s failed', self.getFilePath(), ignored);
    }
    cb();
  });
};

/**
 * Flushes the connection's file descriptor, if applicable.
 * @param {File} file The spi file requesting the operation.
 * @param {function} cb Invoked when the operation is complete.
 * @param {SMBError} cb.error Truthy if there were errors during the operation.
 */
FSFileConnection.prototype.flushFileDescriptor = function (file, cb) {
  var logger = file.getLogger();
  var perflog = file.getPerfLogger();
  logger.debug('[fs] file.flush %s', this.getFilePath());
  var self = this;

  if (this.fd) {
    async.series([
        function (done) {
          // flush modified file buffers to disk
          perflog.debug('%s File.flush.fs.fsync', self.getFilePath());
          fs.fsync(self.fd, SMBError.systemToSMBErrorTranslator(done, 'unable to flush file due to unexpected error ' + self.getFilePath()));
        },
        function (done) {
          // update stats
          self.refreshFileStats(file, done);
        }
      ],
      cb
    );
  } else {
    cb();
  }
};

/**
 * Flushes the connection's file descriptor, if applicable.
 * @param {File} file The spi file requesting the operation.
 * @param {function} cb Invoked when the operation is complete.
 * @param {SMBError} cb.error Truthy if there were errors during the operation.
 */
FSFileConnection.prototype.closeFileDescriptor = function (file, cb) {
  var logger = file.getLogger();
  var perflog = file.getPerfLogger();
  logger.debug('[fs] file.close %s', this.getFilePath());
  var callback = SMBError.systemToSMBErrorTranslator(cb, 'unable to close file due to unexpected error ' + this.getFilePath());

  var self = this;
  // close file descriptor if needed
  if (self.fd) {
    perflog.debug('%s File.close.fs.close', self.getFilePath());
    fs.close(self.fd, function (err) {
      self.fd = undefined;
      callback(err);
    });
  } else {
    // nothing to do
    callback();
  }
};

/**
 * Retrieves the files fs.stat information.
 * @returns {object} File stats.
 */
FSFileConnection.prototype.getStats = function () {
  return this.stats;
};

/**
 * Updates the stats that are being used by the file connection.
 * @param {object} stats New stats to use.
 */
FSFileConnection.prototype.setStats = function (stats) {
  this.stats = stats;
  // extract file permissions from stats.mode, convert to octagonal, check if owner write permission bit is set (00200)
  // see http://stackoverflow.com/questions/11775884/nodejs-file-permissions
  this.writeable = !!(2 & parseInt((stats.mode & parseInt('777', 8)).toString(8)[0]));
};

/**
 * Sets whether or not the file can be written.
 * @param {boolean} writeable New writeable value.
 */
FSFileConnection.prototype.setWriteable = function (writeable) {
  this.writeable = writeable;
};

/**
 * Retrieves the full path to the file on disk.
 * @returns {String} A file path.
 */
FSFileConnection.prototype.getRealPath = function () {
  return this.realPath;
};

/**
 * Retrieves a value indicating whether or not the file is writeable.
 * @returns {boolean} true if writeable, false if not.
 */
FSFileConnection.prototype.getWriteable = function () {
  return this.writeable;
};

/**
 * Creates a new File instance using the connection's information.
 * @param {Tree} tree Will be given to the new File instance.
 * @return {File} Newly created instance.
 */
FSFileConnection.prototype.createFile = function (tree) {
  return new FSFile(this, tree);
};

module.exports = FSFileConnection;
