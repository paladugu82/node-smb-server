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
var Path = require('path');

var mkdirp = require('mkdirp');

var JCRTree = require('../jcr/tree');
var DAMFileConnection = require('./fileconnection');
var utils = require('../../utils');

/**
 * Creates an instance of Tree.
 *
 * @constructor
 * @this {DAMTree}
 * @param {DAMShare} share parent share
 * @param {Object} content JCR node representation
 * @param {Tree} [tempFilesTree] optional Tree implementation for handling temporary files;
 *                               if not specified temp files will be treated just like regular files
 */
var DAMTree = function (treeConnection, context) {
  if (!(this instanceof DAMTree)) {
    return new DAMTree(treeConnection, context);
  }

  JCRTree.call(this, treeConnection, context);
  this.share = treeConnection.share;
  this.tempFilesTree = treeConnection.tempFilesTree ? treeConnection.tempFilesTree.createTree(context) : null;
};

// the DAMTree prototype inherits from JCRTree
Util.inherits(DAMTree, JCRTree);

//---------------------------------------------------------------< JCRTree >

/**
 * Async factory method for creating a File instance
 *
 * @param {String} filePath normalized file path
 * @param {Object} [content=null] file meta data (null if unknown)
 * @param {Number} [fileLength=-1] file length (-1 if unknown)
 * @param {Function} cb callback called with the bytes actually read
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file DAMFile instance
 */
DAMTree.prototype.createFileInstance = function (filePath, content, fileLength, cb) {
  var logger = this.getLogger();
  content = typeof content === 'object' ? content : null;
  fileLength = typeof fileLength === 'number' ? fileLength : -1;
  cb = arguments[arguments.length - 1];
  if (typeof cb !== 'function') {
    logger.error(new Error('DAMTree.createFileInstance: called without callback'));
    cb = function () {};
  }
  DAMFileConnection.createFileInstance(filePath, this, content, fileLength, cb);
};

//---------------------------------------------------------------------< Tree >

/**
 * Test whether or not the specified file exists.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the result
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {Boolean} cb.exists true if the file exists; false otherwise
 */
DAMTree.prototype._exists = function (name, cb) {
  // call base class method
  var self = this;
  self.share.getContent(self, name, false, function (err, content) {
    if (err) {
      cb(err);
    } else {
      cb(null, (content ? true : false));
    }
  });
};

/**
 * Create a new directory.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created directory
 */
DAMTree.prototype._createDirectory = function (name, cb) {
  var self = this;
  var logger = this.getLogger();
  logger.debug('[%s] tree.createDirectory %s', this.share.config.backend, name);
  if (this.tempFilesTree && this.isTempFileName(name)) {
    // make sure parent path exists
    mkdirp.sync(Path.join(this.tempFilesTree.share.path, utils.getParentPath(name)));
    this.tempFilesTree.createDirectory(name, cb);
    return;
  }

  self.share.createDirectoryResource(this, name, function (err) {
    if (err) {
      cb(err);
      return;
    }
    // create DAMFile instance
    self.createFileInstance(name, null, 0, cb);
  });
};

module.exports = DAMTree;
