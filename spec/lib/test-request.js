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

var util = require('util');
var async = require('async');

var TestStream = require('./test-stream');

var requestedUrls = {};
var urls;
var dataz;
var requestCb = function (url, method, headers, cb) {
  cb();
}

function TestRequest(options) {
  TestStream.call(this, 'test-request');

  this.url = options.url;
  this.headers = options.headers || {};
  this.method = options.method || 'GET';
  this.aborted = false;
  this.statusCode = 501;
  this.resCb = false;
}

util.inherits(TestRequest, TestStream);

function setData(url, headers, data) {
  dataz[url] = {headers: headers, data: data};
};

TestRequest.prototype.setStatusCode = function (statusCode) {
  this.statusCode = statusCode;
};

TestRequest.prototype.setResponseCallback = function (callback) {
  var self = this;
  this.setReadStream(function (readCb) {
    callback(self.url, self.headers, function (err, statusCode, data) {
      readCb(err, data);
    });
  });
  this.resCb = callback;
};

TestRequest.prototype.end = function (data, encoding, cb) {
  var self = this;

  function _doEnd(err, statusCode, data) {
    if (err) {
      self.emit('error', err);
      if (cb) {
        cb(err);
      }
    } else {
      if (!statusCode) {
        statusCode = self.statusCode;
      }
      var res = new TestResponse(statusCode);

      if (data) {
        res.end(data);
      } else {
        res.end();
      }

      self.emit('response', res);
      if (cb) {
        cb(null, res);
      }
    }
  }

  TestStream.prototype.end(data, encoding, function (err) {
    if (!err) {
      if (self.method == 'POST') {
        setData(self.url, self.headers, self.getWritten());
        requestCb(self.url, self.method, self.headers, _doEnd);
      } else if (self.method == 'PUT') {
        setData(self.url, self.headers, self.getWritten());
        requestCb(self.url, self.method, self.headers, _doEnd);
      } else if (self.method == 'DELETE') {
        dataz[self.url] = undefined;
        requestCb(self.url, self.method, self.headers, _doEnd);
      } else if (self.resCb) {
        self.resCb(self.url, self.headers, function (err, statusCode, data) {
          requestCb(self.url, self.method, self.headers, function () {
            _doEnd(err, statusCode, data);
          });
        });
      } else {
        requestCb(self.url, self.method, self.headers, _doEnd);
      }
    }
  });
};

TestRequest.prototype.abort = function () {
  this.aborted = true;
};

function TestResponse(statusCode) {
  TestStream.call(this);

  this.statusCode = statusCode;
}

util.inherits(TestResponse, TestStream);

function addRequestedUrl(url, method) {
  if (!requestedUrls[url]) {
    requestedUrls[url] = {};
  }
  if (!requestedUrls[url][method]) {
    requestedUrls[url][method] = 0;
  }
  requestedUrls[url][method]++;
}

function clearAll() {
  requestedUrls = {};
  urls = {};
  dataz = {};
};

function request(options, cb) {
  var method = options.method ? options.method : 'GET';
  addRequestedUrl(options.url, method);

  var req = new TestRequest(options);
  req.on('error', function (err) {
    // caught error event to avoid crash
  });
  if (urls[options.url]) {
    req.setResponseCallback(urls[options.url]);
  } else if (dataz[options.url] && (method == 'DELETE' || method == 'PUT' || method == 'GET')) {
    if (method == 'GET') {
      req.setResponseCallback(function (url, headers, resCb) {
        resCb(null, 200, dataz[options.url]);
      });
    } else {
      req.setStatusCode(200);
    }
  } else if (method == 'POST') {
    req.setStatusCode(201);
  } else {
    req.setStatusCode(404);
  }

  if (cb) {
    req.end(null, null, function (err, res) {
      if (err) {
        cb(err);
      } else {
        cb(null, res, res.getWritten());
      }
    });
  }

  return req;
};

function registerUrl(url, callback) {
  urls[url] = callback;
}

function setRequestCallback(callback) {
  requestCb = callback;
}

function registerUrlStatusCode(url, statusCode) {
  //statusCodes[url] = statusCode;
}

function getUrlMethodRequestCount(url, method) {
  if (requestedUrls[url]) {
    if (requestedUrls[url][method]) {
      return requestedUrls[url][method];
    }
  }
  return 0;
}

function wasUrlRequested(url) {
  return (getUrlMethodRequestCount(url, 'GET') >= 0);
}

function printRegisteredUrls() {
  console.log('urls', urls);
  console.log('datas', dataz);
}

function printRequestedUrls() {
  console.log('requested urls', requestedUrls);
}

module.exports.request = request;
module.exports.clearAll = clearAll;
module.exports.registerUrl = registerUrl;
module.exports.setRequestCallback = setRequestCallback;
module.exports.registerUrlStatusCode = registerUrlStatusCode;
module.exports.wasUrlRequested = wasUrlRequested;
module.exports.getUrlMethodRequestCount = getUrlMethodRequestCount;
module.exports.printRegisteredUrls = printRegisteredUrls;
module.exports.printRequestedUrls = printRequestedUrls;
