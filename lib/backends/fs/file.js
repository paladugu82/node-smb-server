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
var fs = require('fs');

var async = require('async');

var File = require('../../spi/file');
var SMBError = require('../../smberror');

/**
 * Creates an instance of File.
 *
 * @constructor
 * @private
 * @this {FSFile}
 * @param {FileConnection} fileConnection
 * @param {FSTree} tree tree object
 */
var FSFile = function (fileConnection, tree) {
  if (!(this instanceof FSFile)) {
    return new FSFile(fileConnection, tree);
  }

  File.call(this, fileConnection, tree);

  this.realPath = fileConnection.getRealPath();
  this.writeable = fileConnection.getWriteable();
};

// the FSFile prototype inherits from File
util.inherits(FSFile, File);

/**
 * Retrieves the logger that can be used for measuring performance.
 * @returns {object} The logger instance.
 */
FSFile.prototype.getPerfLogger = function () {
  return this.tree.getPerfLogger();
};

/**
 * Refreshes the stats information of the underlying file.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.refreshStats = function (cb) {
  this.fileConnection.refreshFileStats(this, cb);
};

/**
 * Sets the read-only value of the file if needed.
 *
 * @param {Boolean} readOnly If TRUE, file will be read only; otherwise, file will be writable. *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.setReadOnly = function (readOnly, cb) {
  var logger = this.getLogger();
  var self = this;
  if (self.isReadOnly() != readOnly) {
    logger.debug('[fs] setReadOnly %s %s', readOnly, self.filePath);
    var self = this;
    fs.chmod(self.realPath, readOnly ? '444' : '644', function (err) {
      if (err) {
        cb(SMBError.fromSystemError(err, 'unable to set read only status due to unepxected error ' + self.filePath));
      } else {
        self.fileConnection.setWriteable(!readOnly);
        cb();
      }
    });
  } else {
    cb();
  }
};

FSFile.prototype.getDescriptor = function (cb) {
  this.fileConnection.getFileDescriptor(this, cb);
};

//---------------------------------------------------------------------< File >

/**
 * Return a flag indicating whether this is a file.
 *
 * @return {Boolean} <code>true</code> if this is a file;
 *         <code>false</code> otherwise
 */
FSFile.prototype.isFile = function () {
  return this.fileConnection.getStats().isFile();
};

/**
 * Return a flag indicating whether this is a directory.
 *
 * @return {Boolean} <code>true</code> if this is a directory;
 *         <code>false</code> otherwise
 */
FSFile.prototype.isDirectory = function () {
  return this.fileConnection.getStats().isDirectory();
};

/**
 * Return a flag indicating whether this file is read-only.
 *
 * @return {Boolean} <code>true</code> if this file is read-only;
 *         <code>false</code> otherwise
 */
FSFile.prototype.isReadOnly = function () {
  return !this.fileConnection.getWriteable();
};

/**
 * Return the file size.
 *
 * @return {Number} file size, in bytes
 */
FSFile.prototype.size = function () {
  var logger = this.getLogger();
  logger.debug('[fs] size %s (%d bytes)', this.filePath, this.fileConnection.getStats().size);
  return this.fileConnection.getStats().size;
};

/**
 * Return the number of bytes that are allocated to the file.
 *
 * @return {Number} allocation size, in bytes
 */
FSFile.prototype.allocationSize = function () {
  var logger = this.getLogger();
  var size = this.fileConnection.getStats().blocks * this.fileConnection.getStats().blksize;
  logger.debug('[fs] allocationSize %s (%d bytes)', this.filePath, size);
  return size;
};

/**
 * Return the time of last modification, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time of last modification
 */
FSFile.prototype.lastModified = function () {
  return this.fileConnection.getStats().mtime.getTime();
};

/**
 * Sets the time of last modification, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @param {Number} ms
 * @return {Number} time of last modification
 */
FSFile.prototype.setLastModified = function (ms) {
  // cheatin' ...
  this.fileConnection.getStats().mtime = new Date(ms);
};

/**
 * Return the time when file status was last changed, in milliseconds since
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} when file status was last changed
 */
FSFile.prototype.lastChanged = function () {
  return this.fileConnection.getStats().ctime.getTime();
};

/**
 * Return the create time, in milliseconds since Jan 1, 1970, 00:00:00.0.
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time created
 */
FSFile.prototype.created = function () {
  if (this.fileConnection.getStats().birthtime) {
    // node >= v0.12
    return this.fileConnection.getStats().birthtime.getTime();
  } else {
    return this.fileConnection.getStats().ctime.getTime();
  }
};

/**
 * Return the time of last access, in milliseconds since Jan 1, 1970, 00:00:00.0.
 * Jan 1, 1970, 00:00:00.0.
 *
 * @return {Number} time of last access
 */
FSFile.prototype.lastAccessed = function () {
  return this.fileConnection.getStats().atime.getTime();
};

/**
 * Read bytes at a certain position inside the file.
 *
 * @param {Buffer} buffer the buffer that the data will be written to
 * @param {Number} offset the offset in the buffer to start writing at
 * @param {Number} length the number of bytes to read
 * @param {Number} position offset where to begin reading from in the file
 * @param {Function} cb callback called with the bytes actually read
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Number} cb.bytesRead number of bytes actually read
 * @param {Buffer} cb.buffer buffer holding the bytes actually read
 */
FSFile.prototype.read = function (buffer, offset, length, position, cb) {
  var logger = this.getLogger();
  var perflog = this.getPerfLogger();
  logger.debug('[fs] file.read %s offset=%d, length=%d, position=%d', this.filePath, offset, length, position);
  var self = this;

  async.waterfall([
      function (done) {
        self.getDescriptor(done);
      },
      function (fd, done) {
        perflog.debug('%s File.read.fs.read %d', self.filePath, length);
        fs.read(fd, buffer, offset, length, position, SMBError.systemToSMBErrorTranslator(done, 'unable to read file due to unexpected error ' + self.filePath));
      }
    ],
    cb
  );
};

/**
 * Write bytes at a certain position inside the file.
 *
 * @param {Buffer} data buffer to write
 * @param {Number} position position inside file
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.write = function (data, position, cb) {
  var logger = this.getLogger();
  var perflog = this.getPerfLogger();
  logger.debug('[fs] file.write %s data.length=%d, position=%d', this.filePath, data.length, position);
  var self = this;

  async.waterfall([
      function (done) {
        self.getDescriptor(done);
      },
      function (fd, done) {
        perflog.debug('%s File.write.fs.write %d', self.getPath(), data.length);
        fs.write(fd, data, 0, data.length, position, SMBError.systemToSMBErrorTranslator(done, 'unable to write file due to unexpected error ' + self.filePath));
      }
    ],
    cb
  );
};

/**
 * Sets the file length.
 *
 * @param {Number} length file length
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.setLength = function (length, cb) {
  var logger = this.getLogger();
  var perflog = this.getPerfLogger();
  logger.debug('[fs] file.setLength %s length=%d', this.filePath, length);
  var self = this;

  async.series([
      function (done) {
        // first close the file if needed
        self.close(done);
      },
      function (done) {
        // truncate underlying file
        perflog.debug('%s File.setLength.fs.truncate %d', self.getPath(), length);
        fs.truncate(self.realPath, length, SMBError.systemToSMBErrorTranslator(done, 'unable to set file length due to unexpected error ' + self.filePath));
      },
      function (done) {
        // update stats
        self.refreshStats(done);
      }
    ],
    cb
  );
};

/**
 * Delete this file or directory. If this file denotes a directory, it must
 * be empty in order to be deleted.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.delete = function (cb) {
  var logger = this.getLogger();
  var perflog = this.getPerfLogger();
  logger.debug('[fs] file.delete %s', this.filePath);
  var self = this;

  async.series([
      function (done) {
        // first close the file if needed
        self.close(done);
      },
      function (done) {
        // delete underlying file/directory
        if (self.isDirectory()) {
          perflog.debug('%s File.delete.fs.rmdir', self.getPath());
          fs.rmdir(self.realPath, SMBError.systemToSMBErrorTranslator(done, 'unable to delete directory due to unexpected error ' + self.filePath));
        } else {
          perflog.debug('%s File.delete.fs.unlink', self.getPath());
          fs.unlink(self.realPath, SMBError.systemToSMBErrorTranslator(done, 'unable to delete file due to unexpected error ' + self.filePath));
        }
      }
    ],
    cb
  );
};

/**
 * Flush the contents of the file to disk.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.flush = function (cb) {
  this.fileConnection.flushFileDescriptor(this, cb);
};

/**
 * Close this file, releasing any resources.
 *
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
FSFile.prototype.close = function (cb) {
  this.fileConnection.closeFileDescriptor(this, cb);
};

module.exports = FSFile;


