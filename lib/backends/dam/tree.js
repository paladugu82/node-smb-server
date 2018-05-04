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
var stream = require('stream');

var mkdirp = require('mkdirp');

var JCRTree = require('../jcr/tree');
var DAMFileConnection = require('./fileconnection');
var SMBError = require('../../smberror');
var ntstatus = require('../../ntstatus');
var utils = require('../../utils');
var webutils = require('../../webutils');
var JCR = require('../jcr/constants');
var DAM = require('./constants');

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

DAMTree.prototype.fetchFileLength = function (path, cb) {
  // call base class method
  return JCRTree.prototype.fetchFileLength.call(this, path, cb);
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
DAMTree.prototype.exists = function (name, cb) {
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
 * Open an existing file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called with the opened file
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file opened file
 */
DAMTree.prototype.open = function (name, cb) {
  // call base class method
  return JCRTree.prototype.open.call(this, name, cb);
};

/**
 * List entries, matching a specified pattern.
 *
 * @param {String} pattern pattern
 * @param {Function} cb callback called with an array of matching files
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File[]} cb.files array of matching files
 */
DAMTree.prototype.list = function (pattern, cb) {
  // call base class method
  return JCRTree.prototype.list.call(this, pattern, cb);
};

/**
 * Create a new file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created file
 */
DAMTree.prototype.createFile = function (name, cb) {
  JCRTree.prototype.createFile.call(this, name, cb);
};

function _getJcrTitleProperties(title) {
  var props = {
    properties: {}
  };
  props.properties[JCR.JCR_TITLE] = title;
  return JSON.stringify(props);
};

/**
 * Create a new directory.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {File} cb.file created directory
 */
DAMTree.prototype.createDirectory = function (name, cb) {
  var self = this;
  var logger = this.getLogger();
  logger.debug('[%s] tree.createDirectory %s', this.share.config.backend, name);
  if (this.tempFilesTree && this.isTempFileName(name)) {
    // make sure parent path exists
    mkdirp.sync(Path.join(this.tempFilesTree.share.path, utils.getParentPath(name)));
    this.tempFilesTree.createDirectory(name, cb);
    return;
  }

  var req = self.share.createDirectoryResource(this, name, function (err) {
    if (err) {
      cb(err);
      return;
    }
    // create DAMFile instance
    self.createFileInstance(name, null, 0, cb);
  });

  // make sure jcr title is set in DAM
  var pathName = utils.getPathName(name);
  var props = {
    properties: {}
  };
  props.properties[JCR.JCR_TITLE] = pathName;
  req.write(_getJcrTitleProperties(pathName));
  req.end();
};

/**
 * Delete a file.
 *
 * @param {String} name file name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
DAMTree.prototype.delete = function (name, cb) {
  JCRTree.prototype.delete.call(this, name, cb);
};

/**
 * Delete a directory. It must be empty in order to be deleted.
 *
 * @param {String} name directory name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
DAMTree.prototype.deleteDirectory = function (name, cb) {
  JCRTree.prototype.deleteDirectory.call(this, name, cb);
};

/**
 * Sends an update request that will change the given path's jcr:title to match the path.
 * @param {string} path The path to be updated. The new title will be extracted from the path.
 * @param {function} cb Will be invoked when the update is complete.
 */
function _updateTitle(path, cb) {
  var logger = this.getLogger();
  var url = this.share.buildResourceUrl(path);
  var newTitle = utils.getPathName(path);
  var options = this.share.applyRequestDefaults(this, {
    url: url,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
  options.headers[JCR.ACTION_HEADER] = JCR.ACTION_UPDATETITLE;
  var req = webutils.submitRequest(options, function (err, resp, body) {
    if (err) {
      logger.error('failed to update title for %s', path, err);
    } else if (resp.statusCode !== 200) {
      logger.error('failed to update title for %s - %s %s [%d]', path, this.method, this.href, resp.statusCode, body);
    }
    cb();
  });
  req.write(_getJcrTitleProperties(newTitle));
  req.end();
}

/**
 * Rename a file or directory.
 *
 * @param {String} oldName old name
 * @param {String} newName new name
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
DAMTree.prototype.rename = function (oldName, newName, cb) {
  var self = this;
  JCRTree.prototype.rename.call(this, oldName, newName, function (err) {
    if (err) {
      cb(err);
      return;
    }
    _updateTitle.call(self, newName, cb);
  });
};

/**
 * Refresh a specific folder.
 *
 * @param {String} folderPath
 * @param {Boolean} deep
 * @param {Function} cb callback called on completion
 * @param {SMBError} cb.error error (non-null if an error occurred)
 */
DAMTree.prototype.refresh = function (folderPath, deep, cb) {
  // call base class method
  return JCRTree.prototype.refresh.call(this, folderPath, deep, cb);
};

module.exports = DAMTree;
