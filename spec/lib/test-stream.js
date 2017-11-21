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
}

util.inherits(TestStream, EventEmitter);

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
  this.written += chunk;
  if (cb) {
    cb();
  }
};

TestStream.prototype.end = function (data, encoding, cb) {
  if (data) {
    this.written += data;
  }
  this.emit('finish');
  if (cb) {
    cb();
  }
};

TestStream.prototype.pipe = function (other) {
  var self = this;

  function _emitEnd(data) {
    self.emit('end');
    other.end(data, 'utf8');
  }

  if (this.readCb) {
    this.readCb(function (err, data) {
      if (err) {
        self.emit('error', err);
      } else {
        self.emit('data', data);
        _emitEnd(data);
      }
    });
  } else {
    throw 'Test stream is not a read stream';
  }
};

TestStream.prototype.getWritten = function () {
  return this.written;
};

module.exports = TestStream;
