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

var events = require('events');
var EventEmitter = events.EventEmitter;
var Datastore = require('lokijs');
var util = require('util');

var utils = require('../../lib/utils');
var TestStream = require('./test-stream');

var ID_FIELD = '$loki';

function TestFS() {
  this.clearAll();
  this.allowDirDelete = false;

  EventEmitter.call(this);
}

util.inherits(TestFS, EventEmitter);

function _findByPath(path, cb) {
  var self = this;
  var doc;

  process.nextTick(function () {
    try {
      doc = _findByPathSync.call(self, path);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, doc);
  });
}

function _findByPathSync(path) {
  path = _trimSlash(path);
  var dir = utils.getParentPath(path);
  var name = utils.getPathName(path);
  var docs = this.allFiles.find({path: dir, name: name});

  if (docs.length > 1) {
    throw 'duplicate file encountered ' + path;
  } else {
    return docs.length > 0 ? docs[0] : false;
  }
}

function _findById(id, cb) {
  var self = this;
  var doc;

  process.nextTick(function () {
    try {
      doc = _findByIdSync.call(self, id);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, doc);
  });
}

function _findByIdSync(id) {
  var idFilter = {};
  idFilter[ID_FIELD] = id;
  var docs = this.allFiles.find(idFilter);
  if (docs.length == 0 ) {
    throw 'cannot find file with id ' + id;
  } else {
    return docs[0];
  }
}

function _extendDoc(origDoc) {
  var self = this;
  // copy the doc to ensure that database changes don't impact existing stats
  var doc = Object.assign({}, origDoc);
  doc['isDirectory'] = function () {
    return doc.isdir;
  };
  doc['isFile'] = function () {
    return !doc.isdir;
  };
  Object.defineProperty(doc, 'mtime', {
    get: function() {
      return this._mtime;
    },
    set: function (modified) {
      this._mtime = modified;
      _updateByIdSync.call(self, this[ID_FIELD], {_mtime: modified, ctime: modified}, false);
    },
    configurable: true
  });
  return doc;
}

function _updateByFilter(filter, updateData, newCreated, cb) {
  var self = this;

  setTimeout(function () { // pause to ensure dates change
    var date = new Date();
    if (!updateData['_mtime']) {
      updateData['_mtime'] = date;
      updateData['ctime'] = date;
    }
    updateData['atime'] = date;

    if (newCreated) {
      updateData['birthtime'] = date;
    }

    var updateCount = 0;
    self.allFiles.findAndUpdate(filter, function (toUpdate) {
      for (var key in updateData) {
        toUpdate[key] = updateData[key];
      }
      updateCount++;
      return toUpdate;
    });

    if (updateCount != 1) {
      cb('unexpected number of records updated: ' + updateCount);
    } else {
      cb(null, updateCount);
    }
  }, 5);
}

function _updateByName(updateName, updateData, newCreated, cb) {
  var dir = utils.getParentPath(updateName);
  var name = utils.getPathName(updateName);
  _updateByFilter.call(this, {path: dir, name: name}, updateData, newCreated, cb);
}

function _updateById(id, updateData, newCreated, cb) {
  var idFilter = {};
  idFilter[ID_FIELD] = id;
  _updateByFilter.call(this, idFilter, updateData, newCreated, cb);
}

function _updateByIdSync(id, updateData, newCreated) {
  var self = this;
  var sync = true;
  var syncErr = null;
  _updateById.call(self, id, updateData, newCreated, function(err) {
    syncErr = err;
    sync = false;
  });
  while(sync) {require('deasync').sleep(100);}

  if (syncErr) {
    throw syncErr;
  }

  return false;
}

function _trimSlash(path) {
  if (path.charAt(path.length - 1) == '/') {
    path = path.substr(0, path.length - 1);
  }
  return path;
}

TestFS.prototype.allowDeleteNonEmptyDir = function (allow) {
  this.allowDirDelete = allow ? true : false;
};

TestFS.prototype.printAll = function () {
  var docs = this.allFiles.find({});
  console.log(docs);
};

TestFS.prototype.mkdirp = function (path, cb) {
  var self = this;
  process.nextTick(function () {
    try {
      self.mkdirpSync(path);
    } catch (e) {
      cb(e);
      return;
    }
    cb();
  });
};

TestFS.prototype.mkdirpSync = function (path) {
  var paths = path.toString().split('/');
  var parent = '/';
  for (var i = 0; i < paths.length; i++) {
    var currPath = paths[i];
    if (currPath) {
      this.createEntityIfNoExistSync(parent + currPath, true);
      parent += currPath + '/';
    }
  }
};

TestFS.prototype.createEntityIfNoExist = function (path, isDir, cb) {
  var self = this;
  process.nextTick(function () {
    try {
      self.createEntityIfNoExistSync(path, isDir);
    } catch (e) {
      cb(e);
      return;
    }
    cb();
  });
};

TestFS.prototype.createEntityIfNoExistSync = function (path, isDir) {
  var file = _findByPathSync.call(this, path);
  if (!file) {
    this.createEntitySync(path, isDir);
  }
};

TestFS.prototype.createEntityWithDates = function (path, isDir, content, created, lastModified, cb) {
  var self = this;

  process.nextTick(function () {
    var id;

    try {
      id = self.createEntityWithDatesSync(path, isDir, content, created, lastModified);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, id);
  });
};

TestFS.prototype.createEntityWithDatesSync = function (path, isDir, content, created, lastModified) {
  var self = this;
  var dir = '';
  var name = path;
  if (path != '/') {
    dir = utils.getParentPath(path);
    name = utils.getPathName(path);
  }
  var size = content ? content.length : 0;

  self.mkdirpSync(dir);
  var entity = {
    path: dir,
    name: name,
    mode: 33188,
    size: 0,
    blocks: 1,
    blksize: 0,
    birthtime: created,
    _mtime: lastModified,
    atime: lastModified,
    ctime: lastModified,
    isdir: isDir
  };

  if (!isDir) {
    entity['data'] = content;
    entity.size = size;
    entity.blksize = size;
  }
  var doc = self.allFiles.insert(entity);
  return doc[ID_FIELD];
};

TestFS.prototype.createEntity = function (path, isDir, cb) {
  var self = this;
  process.nextTick(function () {
    var id;
    try {
      id = self.createEntitySync(path, isDir);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, id);
  });
};

TestFS.prototype.createEntitySync = function (path, isDir) {
  var date = new Date();
  return this.createEntityWithDatesSync(path, isDir, '', date, date);
};

TestFS.prototype.open = function (path, mode, cb) {
  var self = this;

  process.nextTick(function () {
    var id;
    try {
      id = self.openSync(path, mode);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, id);
  });
};

TestFS.prototype.openSync = function (path, mode) {
  var self = this;

  var file = _findByPathSync.call(self, path);

  if (mode.indexOf('r') >= 0) {
    if (!file) {
      throw 'file opened for reading does not exist: ' + path;
    } else {
      return file[ID_FIELD];
    }
  } else if (mode.indexOf('w') >= 0) {
    if (mode.indexOf('x') >= 0 && file) {
      throw 'file opened for writing already exists ' + path;
    } else if (file) {
      return file[ID_FIELD];
    } else {
      return self.createEntitySync(path, false);
    }
  } else {
    throw 'unsupported open mode ' + mode;
  }
};

TestFS.prototype.close = function (fd, cb) {
  var self = this;
  process.nextTick(function () {
    self.closeSync(fd);
    cb();
  });
};

TestFS.prototype.closeSync = function (fd) {

};

TestFS.prototype.clearAll = function () {
  this.db = new Datastore();
  this.allFiles = this.db.addCollection('files');
  this.paths = {};
};

TestFS.prototype.createReadStream = function (filePath, options) {
  var self = this;

  var stream = new TestStream(filePath);

  var file;
  if (filePath) {
    file = _findByPathSync.call(self, filePath);
  } else {
    file = _findByIdSync.call(self, options.fd);
  }

  stream.setReadStream(function (readCb) {
    var buff = new Array(file.size);
    self.read(file[ID_FIELD], buff, 0, file.size, 0, function (err) {
      if (err) {
        readCb(err);
      } else {
        var data = buff.join('');
        if (self.paths[filePath]) {
          self.paths[filePath](filePath, data, function (err, finalData) {
            if (err) {
              readCb(err);
            } else {
              readCb(null, finalData);
            }
          });
        } else {
          readCb(null, data);
        }
      }
    });
  });

  return stream;
};

TestFS.prototype.realPath = function (path, options, cb) {
  var self = this;
  if (!cb) {
    cb = options;
  }

  process.nextTick(function () {
    cb(null, self.realPathSync(path));
  });
};

TestFS.prototype.realPathSync = function (path) {
  return path;
};

TestFS.prototype.registerPath = function (filePath, callback) {
  this.paths[filePath] = callback;
};

TestFS.prototype.createWriteStream = function (filePath) {
  return new FileStream(this, filePath);
};

TestFS.prototype.statSync = function (filePath) {
  var file = _findByPathSync.call(this, filePath);
  if (!file) {
    throw {code: 'ENOENT', message: 'file to stat not found ' + filePath};
  } else {
    return _extendDoc.call(this, file);
  }
};

TestFS.prototype.stat = function (filePath, cb) {
  var self = this;

  process.nextTick(function () {
    var stat;
    try {
      stat = self.statSync(filePath);
    } catch (e) {
      cb(e);
      return;
    }
    cb(null, stat);
  });
};

TestFS.prototype.fstat = function (fd, cb) {
  var self = this;
  _findById.call(self, fd, function (err, file) {
    if (err) {
      cb({code: 'ENOENT', message: err});
    } else {
      cb(null, _extendDoc.call(this, file));
    }
  });
};

TestFS.prototype.truncate = function (path, length, cb) {
  var self = this;

  // path can be either a file descriptor or a physical path. handle both.
  _findByPath.call(self, path, function (err, pathItem) {
    if (err) {
      cb(err);
    } else if (pathItem) {
      _updateByName.call(self, path, {size: length, blksize: length}, false, function (err) {
        if (err) {
          cb(err);
        } else {
          cb();
        }
      });
    } else {
      _updateById.call(self, path, {size: length, blksize: length}, false, function (err) {
        if (err) {
          cb(err);
        } else {
          cb();
        }
      });
    }
  });
};

TestFS.prototype.ftruncate = function (path, length, cb) {
  this.truncate(path, length, cb);
};

TestFS.prototype.write = function (fd, data, offset, length, position, cb) {
  var self = this;

  _findById.call(self, fd, function (err, file) {
    if (err) {
      cb(err);
    } else {
      length = position + length > file.size ? file.size - position : length;
      var currValue = file.data;
      var before = '';
      var after = '';
      if (currValue.length > position) {
        before = currValue.substr(0, position);
      }
      if (currValue.length > position + length) {
        after = currValue.substr(position + length);
      }

      var written = '';
      for (var i = offset; i < offset + length; i++) {
        var b;
        if (data instanceof Buffer) {
          b = data.toString('utf8', i, i + 1);
        } else {
          b = data[i];
        }
        written += b;
      }
      _updateById.call(self, fd, {data: before + written + after}, false, function (err) {
        if (err) {
          cb(err);
        } else {
          cb(null, length, written);
        }
      });
    }
  });
};

TestFS.prototype.read = function (fd, buffer, offset, length, position, cb) {
  var self = this;
  _findById.call(self, fd, function (err, file) {
    if (err) {
      cb(err);
    } else {
      var data = file.data;
      var lastIndex = position + length;
      if (lastIndex >= data.length) {
        lastIndex = data.length;
      }
      if (lastIndex > buffer.length) {
        lastIndex = buffer.length;
      }
      var totalToRead = lastIndex - position;
      var retBuff = new Buffer(totalToRead);
      var currRead = 0;
      for (var i = position; i < lastIndex; i++) {
        var targetIndex = offset + currRead;
        if (buffer instanceof Buffer) {
          buffer.write(data[i], targetIndex);
        } else {
          buffer[targetIndex] = data[i];
        }
        retBuff.write(data[i], currRead);
        currRead++;
      }
      cb(null, totalToRead, retBuff);
    }
  });
};

TestFS.prototype.unlinkSync = function (path) {
  this.statSync(path);
  var dir = utils.getParentPath(path);
  var name = utils.getPathName(path);
  this.allFiles.findAndRemove({path: dir, name: name});
};

TestFS.prototype.unlink = function (path, cb) {
  var self = this;
  process.nextTick(function () {
    try {
      self.unlinkSync(path);
    } catch (e) {
      cb(e);
      return;
    }
    cb();
  });
};

TestFS.prototype.readdir = function (folderPath, callback) {
  var self = this;
  process.nextTick(function () {
    var names;
    try {
      names = self.readdirSync(folderPath);
    } catch (e) {
      callback(e);
      return;
    }

    callback(null, names);
  });
};

TestFS.prototype.readdirSync = function (folderPath) {
  folderPath = _trimSlash(folderPath) || '/';
  if (folderPath != '/') {
    this.statSync(folderPath);
  }
  var docs = this.allFiles.find({path: folderPath});
  var names = [];
  for (var i = 0; i < docs.length; i++) {
    names.push(docs[i].name);
  }
  return names;
};

function _rmdir(path, allowNotEmpty, cb) {
  var self = this;
  var dir = utils.getParentPath(path);
  var name = utils.getPathName(path);

  var stat;
  try {
    stat = self.statSync(path);
  } catch (e) {
    cb(e);
    return;
  }

  if (!stat.isDirectory()) {
    cb('dir to remove is not a directory: ' + path);
    return;
  }

  self.readdir(path, function (err, files) {
    if (err) {
      cb(err);
    } else if (files.length && !allowNotEmpty) {
      cb('directory to remove is not empty: ' + path);
    } else {
      var subItems = _getSubEntities.call(self, path);
      for (var i = 0; i < subItems.length; i++) {
        var idFilter = {};
        idFilter[ID_FIELD] = subItems[i][ID_FIELD];
        self.allFiles.findAndRemove(idFilter);
      }
      self.allFiles.findAndRemove({path: dir, name: name});
      cb();
    }
  });
}

TestFS.prototype.rmdir = function (path, cb) {
  _rmdir.call(this, path, this.allowDirDelete, cb);
};

TestFS.prototype.rename = function (oldName, newName, cb) {
  var self = this;
  var newDir = utils.getParentPath(newName);
  var newPathName = utils.getPathName(newName);

  function _removeTarget(callback) {
    // remove target file if needed
    var targetExists = true;
    var stat;
    try {
      stat = self.statSync(newName);
    } catch (e) {
      targetExists = false;
    }
    if (targetExists) {
      if (stat.isDirectory()) {
        _rmdir.call(self, newName, true, callback);
      } else {
        self.unlink(newName, callback);
      }
    } else {
      callback();
    }
  }

  try {
    self.statSync(oldName);
  } catch (e) {
    cb(e);
    return;
  }

  _removeTarget(function (err) {
    if (err) {
      cb(err);
      return;
    }
    _updateByName.call(self, oldName, {path: newDir, name: newPathName}, true, function (err, numUpdated) {
      if (err) {
        cb(err);
      } else if (numUpdated != 1) {
        cb('unexpected number of items renamed from ' + oldName + ' to ' + newName + ': ' + numUpdated);
      } else {
        var docs = _getSubEntities.call(self, oldName);
        for (var i = 0; i < docs.length; i++) {
          var doc = docs[i];
          var doReplace = false;
          if (doc.path == oldName) {
            doReplace = newName;
          } else if (doc.path.length > oldName.length) {
            doReplace = newName + doc.path.substr(oldName.length);
          }
          if (doReplace) {
            var idFilter = {};
            idFilter[ID_FIELD] = doc[ID_FIELD];
            self.allFiles.findAndUpdate(idFilter, function (toUpdate) {
              toUpdate.path = doReplace;
              return toUpdate;
            });
          }
        }
        cb();
      }
    });
  });
};

function _getSubEntities(path) {
  var docs = this.allFiles.find({});
  var entities = [];
  for (var i = 0; i < docs.length; i++) {
    if (docs[i].path == path) {
      entities.push(docs[i]);
    } else if (docs[i].path.substr(0, path.length + 1) == path + '/') {
      entities.push(docs[i]);
    }
  }
  return entities;
}

TestFS.prototype.chmod = function (path, mode, cb) {
  cb();
};

TestFS.prototype.fsync = function (fd, cb) {
  cb();
};

function FileStream(testfs, filePath) {
  TestStream.call(this, filePath);

  this.testfs = testfs;
}

util.inherits(FileStream, TestStream);

FileStream.prototype.doEnd = function (data, encoding, cb) {
  var self = this;
  function evokeCallback(err) {
    if (err) {
      self.emit('error');
    }
    if (cb) {
      cb(err);
    }
  }

  TestStream.prototype.doEnd.call(self, data, encoding, function (err) {
    self.testfs.open(self.path, 'wx', function (err, fd) {
      if (err) {
        cb(err);
      } else if (self.getWritten().length > 0) {
        self.testfs.truncate(self.path, self.getWritten().length, function (err) {
          if (err) {
            evokeCallback(err);
            return;
          }
          self.testfs.write(fd, self.getWritten(), 0, self.getWritten().length, 0, evokeCallback);
        });
      } else {
        evokeCallback();
      }
    });
  });
};

module.exports = TestFS;
