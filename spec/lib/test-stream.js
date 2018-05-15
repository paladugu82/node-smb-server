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

var EventEmitter = require('events').EventEmitter;
var util = require('util');

function TestStream(target) {
  EventEmitter.call(this);

  this.path = target;
  this.written = '';
  this.ended = false;
}

util.inherits(TestStream, EventEmitter);

TestStream.Writable = TestStream;
TestStream.Stream = TestStream;

TestStream.PassThrough = function () {
  var stream = new TestStream();
  stream.setReadStream(function (cb) {
    cb();
  });
  return stream;
};

TestStream.prototype.setReadStream = function (readCb) {
  this.readCb = readCb;
};

TestStream.prototype.write = function (chunk, encoding, cb) {
  if (chunk instanceof Buffer) {
    chunk = chunk.toString();
  }
  if (chunk) {
    this.written += chunk;
  }
  process.nextTick(function () {
    if (cb) {
      cb();
    }
  });
};

TestStream.prototype.end = function (data, encoding, cb) {
  var self = this;
  this.streaming = true;
  this.doEnd(data, encoding, function (err) {
    if (err) {
      self.emit('error', err);
      return;
    }
    self.emit('finish');
  });
};

TestStream.prototype.doEnd = function (data, encoding, cb) {
  var self = this;
  if (this.ended) {
    throw new Error('stream has already ended');
  }
  this.ended = true;
  process.nextTick(function () {
    self.write(data, encoding, function (err) {
      if (err) {
        self.emit('error', err);
      } else {
        self.emit('end');
      }
      if (cb) {
        cb();
      }
    });
  });
};

TestStream.prototype.pipe = function (other) {
  this.streaming = true;
  other.streaming = true;

  this.doPipe(other);
};

TestStream.prototype.doPipe = function (other) {
  var self = this;
  function doEnd(callback) {
    if (!self.ended) {
      self.doEnd(null, null, callback);
    } else {
      callback();
    }
  }
  self.readAll(function (err, data) {
    if (!err) {
      doEnd(function (err) {
        if (!err) {
          other.endPipe(data, 'utf8');
        } else {
          other.emit('error', err);
        }
      });
    } else {
      self.emit('error', err);
    }
  });
};

TestStream.prototype.endPipe = function (data, encoding, cb) {
  this.end(data, encoding, cb);
};

TestStream.prototype.readAll = function (cb) {
  var self = this;
  if (self.readCb) {
    self.readCb(function (err, data) {
      process.nextTick(function () {
        if (err) {
          self.emitError(err);
          cb(err);
        } else {
          if (data) {
            self.emit('data', data);
          }
          cb(null, data);
        }
      });
    });
  } else {
    throw 'Test stream is not a read stream';
  }
};

TestStream.prototype.getWritten = function () {
  return this.written;
};

TestStream.prototype.emitError = function (err) {
  if (!this.errorEmitted) {
    this.errorEmitted = true;
    this.emit('error', err);
  }
};

module.exports = TestStream;
