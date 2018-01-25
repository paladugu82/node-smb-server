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

var testfs = require('./test-fs');
var testDatastore = require('./test-nedb');
var testMkdirp = require('./test-mkdirp');
var testRequest = require('./test-request');
var testHttp = require('./test-http');
var testSocketIO = require('./test-socketio');
var testExpress = require('./test-express');
var testBodyParser = require('./test-body-parser');
var testArchiver = require('./test-archiver');
var testTmp = require('./test-tmp');
var testStream = require('./test-stream');

var globalfs = new testfs();
var globalMkdirp = new testMkdirp(globalfs);
var globalHttp = new testHttp();
var globalSocketIO = new testSocketIO();
var globalExpress = new testExpress();
var globalBodyParser = new testBodyParser();
var globalArchiver = new testArchiver();
var globalTmp = new testTmp(globalfs);

globalfs['@global'] = true;
testRequest.request['@global'] = true;
testDatastore['@global'] = true;
globalMkdirp.mkdirp['@global'] = true;
globalHttp['@global'] = true;
globalSocketIO.create['@global'] = true;
globalExpress.create['@global'] = true;
globalExpress.create['static'] = globalExpress.static;
globalBodyParser['@global'] = true;
globalArchiver.archive['@global'] = true;
globalTmp['@global'] = true;
testStream['@global'] = true;

var proxyquire = require('proxyquire').noCallThru();

var events = require('events').EventEmitter;
var Path = require('path');

// force paths to use forward slashes for compatibility
Path.sep = '/';
Path.join2 = Path.join;
Path.join = function () {
  var res = Path.join2.apply({}, arguments);
  return res.replace(/\\/g, Path.sep);
};

var firstLoad = true;

function TestCommon() {
  EventEmitter.call(this);
  var self = this;

  globalfs.clearAll();
  testRequest.clearAll();

  self.fs = globalfs;
  self.request = testRequest;
  self.mkdirp = globalMkdirp.mkdirp;

  if (firstLoad) {
    firstLoad = false;
    spyOn(globalfs, 'createReadStream').andCallThrough();
    spyOn(globalfs, 'createWriteStream').andCallThrough();
    spyOn(globalfs, 'writeFileSync').andCallThrough();
    spyOn(globalfs, 'unlinkSync').andCallThrough();
    spyOn(globalfs, 'statSync').andCallThrough();
  }
}

util.inherits(TestCommon, EventEmitter);

TestCommon.require = function (dirname, name) {
  return TestCommon.requireStubs(dirname, name);
};

TestCommon.requireStubs = function (dirname, name, stubs) {
  stubs = stubs || {};
  stubs['request'] = testRequest.request;
  stubs['requestretry'] = testRequest.request;
  stubs['fs'] = globalfs;
  stubs['mkdirp'] = globalMkdirp.mkdirp;
  stubs['nedb'] = testDatastore;
  stubs['socket.io'] = globalSocketIO.create;
  stubs['http'] = globalHttp;
  stubs['express'] = globalExpress.create;
  stubs['body-parser'] = globalBodyParser;
  stubs['archiver'] = globalArchiver.archive;
  stubs['temp'] = globalTmp;
  stubs['stream'] = testStream;
  return proxyquire(Path.join(dirname, name), stubs);
};

TestCommon.runSync = function () {
  var asyncFunc = arguments.pop();
  var sync = true;
  asyncFunc.apply(null, arguments, function () {
    sync = false;
  });
  while(sync) {require('deasync').sleep(100);}

  return true;
};

module.exports = TestCommon;
