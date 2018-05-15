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
var URL = require('url');
var ReadWriteLock = require('rwlock');

var TestStream = require('./test-stream');
var utils = require('../../lib/utils');

var requestedUrls = {};
var urls = {};
var dataz = {};
var requestCb = function (options, cb) {
  cb();
}

function TestForm(req) {
  this.data = {};
  this.req = req;
};

TestForm.prototype.append = function (name, value) {
  var self = this;
  this.data[name] = value;
  if (value.pipe) {
    value.pipe(self.req);
  }
};

function TestRequest(options, reqCb) {
  TestStream.call(this, 'test-request');

  this.options = options;
  this.options['method'] = options.method || 'GET';
  this.options['headers'] = options.headers || {};
  this.url = options.url;
  this.headers = options.headers;
  this.method = options.method;
  this.aborted = false;
  this.resCb = false;
  this.reqCb = reqCb;
  this.reqForm = new TestForm(this);
  this.lock = new ReadWriteLock();
}

util.inherits(TestRequest, TestStream);

function setData(url, headers, data) {
  dataz[url] = {headers: headers, data: data};
};

TestRequest.prototype.setResponseCallback = function (callback) {
  var self = this;
  this.setReadStream(function (readCb) {
    // at this point the registered response data has been determined already, so provide whatever the data ended up
    // being
    readCb(null, self.responseData || '');
  });
  this.resCb = callback;
};

TestRequest.prototype.getResponse = function (cb) {
  var self = this;

  function getTargetUrl(currUrl, targetUrl) {
    var currParsed = URL.parse(currUrl);
    var targetParsed = URL.parse(targetUrl);

    if (!targetParsed.host) {
      return currParsed.protocol + '//' + currParsed.host + targetUrl;
    } else {
      return targetUrl;
    }
  }

  function createResponse(err, statusCode, resData, release) {
    if (err) {
      release();
      self.emit('error', err);

      // invoke the callback that was originally provided to the request call.
      if (self.reqCb) {
        self.reqCb(err);
      }
    } else {
      self.response = new TestResponse(statusCode, resData);
      self.responseData = resData;
      release();

      self.emit('response', self.response);

      cb(self.response);
    }
  }

  self.lock.writeLock(function (release) {
    if (!self.response) {
      var reqData = self.getWritten();
      self.options['data'] = reqData || '';
      self.options['form'] = self.reqForm.data;
      // provide opportunity for external entities to process request
      requestCb(self.options, function (options) {
        if (!options) {
          options = self.options;
        } else {
          self.options = options;
        }
        var defaultStatusCode = 501;
        var method = options.method;
        var url = options.url;
        var headers = options.headers;
        var defaultResData = '';

        // handle the method using the default functionality of the request, including managing the request's
        // data and determining the response status code
        if (method == 'POST') {
          if (dataz[url] !== undefined) {
            defaultStatusCode = 409;
          } else {
            defaultStatusCode = 201;
            defaultResData = 'created';
          }
        } else if (method == 'PUT') {
          defaultStatusCode = 404;
          if (dataz[url] !== undefined) {
            defaultStatusCode = 200;
            defaultResData = 'updated';
          }
        } else if (method == 'DELETE') {
          defaultStatusCode = 404;
          if (dataz[url] !== undefined) {
            delete dataz[url];
            defaultStatusCode = 200;
            defaultResData = 'deleted';
          }
        } else if (method == 'MOVE') {
          defaultStatusCode = 404;
          if (dataz[url] !== undefined) {
            var targetUrl = getTargetUrl(url, headers['X-Destination']);
            headers['X-Destination'] = targetUrl;
            if (dataz[targetUrl] !== undefined) {
              defaultStatusCode = 409;
            } else {
              defaultStatusCode = 201;
              defaultResData = 'moved';
              dataz[targetUrl] = dataz[url];
              delete dataz[url];
              if (urls[url]) {
                urls[targetUrl] = urls[url];
                delete urls[url];
              }
            }
          }
        } else if (method == 'HEAD' || method == 'GET') {
          defaultStatusCode = 404;
          if (dataz[url] !== undefined) {
            defaultStatusCode = 200;
            if (method == 'GET') {
              defaultResData = dataz[url].data;
            }
          }
        }
        // provide an opportunity for external entities to handle the response for the url
        if (self.resCb) {
          self.resCb(options, function (err, statusCode, customData) {
            // external entity has handled the url, provide the custom status code and data (if provided). If not
            // provided, send the default code and data
            createResponse(err, statusCode || defaultStatusCode, customData || defaultResData, release);
          });
        } else {
          // no external entity needs to handle the url, provide the default status code and data
          createResponse(null, defaultStatusCode, defaultResData, release);
        }
      });
    } else {
      release();
      cb(self.response);
    }
  });
};

TestRequest.prototype.doEnd = function (data, encoding, cb) {
  var self = this;
  if (!self.aborted) {
    var self = this;
    process.nextTick(function () {
      self.getResponse(function (res) {
        res.doEnd(null, null, function (err) {
          if (err) {
            self.emit('error', err);
            if (cb) {
              cb(err);
            }
            return;
          }
          TestStream.prototype.doEnd.call(self, data, encoding, function (err) {
            if (!err) {
              if (self.options.method == 'POST' || self.options.method == 'PUT') {
                setData(self.options.url, self.options.headers, self.getWritten());
              }

              if (cb) {
                cb(null, res);
              }
              // invoke the callback that was originally provided to the request call.
              if (self.reqCb) {
                self.reqCb(null, res, res.getWritten());
              }
            }
          });
        });
      });
    });
  }
};

TestRequest.prototype.endPipe = function (data, encoding, cb) {
  this.doEnd(data, encoding, cb);
};

TestRequest.prototype.abort = function () {
  this.aborted = true;
  this.emit('abort');
};

TestRequest.prototype.form = function () {
  return this.reqForm;
};

TestRequest.prototype.doPipe = function (other) {
  var self = this;
  self.getResponse(function () {
    TestStream.prototype.doPipe.call(self, other);
  });
};

function TestResponse(statusCode, data) {
  TestStream.call(this);

  this.headers = {};
  this.statusCode = statusCode;
  this.statusMessage = '';
  this.data = data || '';
}

util.inherits(TestResponse, TestStream);

TestResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
  this.statusCode = statusCode;
  this.headers = headers || {};
  this.statusMessage = statusMessage || '';
};

function _writeResponseData(encoding, callback) {
  var self = this;
  process.nextTick(function () {
    if (self.data) {
      var toWrite = self.data;
      self.data = '';
      TestStream.prototype.write.call(self, toWrite, encoding, function (err) {
        if (err) {
          self.emit('error', err);
          callback(err);
          return;
        }
        callback();
      });
    } else {
      callback();
    }
  });
}

TestResponse.prototype.write = function (data, encoding, cb) {
  var self = this;
  _writeResponseData.call(self, encoding, function (err) {
    if (err && cb) {
      cb(err);
      return;
    }
    TestStream.prototype.write.call(self, data, encoding, cb);
  });
};

TestResponse.prototype.doEnd = function (data, encoding, cb) {
  var self = this;
  _writeResponseData.call(self, encoding, function (err) {
    if (err && cb) {
      cb(err);
      return;
    }
    TestStream.prototype.doEnd.call(self, data, encoding, cb);
  });
};

TestResponse.prototype.endPipe = function (data, encoding, cb) {
  this.doEnd(data, encoding, cb);
};

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
  requestCb = function (options, cb) {
    cb();
  }
};

function request(options, cb) {
  var method = options.method ? options.method : 'GET';
  addRequestedUrl(options.url, method);

  var req = new TestRequest(options, cb);
  req.on('error', function (err) {
    // caught error event to avoid crash
  });

  if (urls[options.url]) {
    req.setResponseCallback(urls[options.url]);
  } else if (dataz[options.url] && (method != 'POST') && method != 'MOVE') {
    if (method == 'GET') {
      req.setResponseCallback(function (resOptions, resCb) {
        resCb(null, 200, dataz[options.url].data);
      });
    }
  }

  process.nextTick(function () {
    if (!req.ended && !req.streaming) {
      req.doEnd();
    }
  });

  return req;
};

function registerUrl(url, callback) {
  urls[url] = callback;
}

function unregisterUrl(url) {
  delete urls[url];
}

function setUrlData(url, data) {
  if (!dataz[url]) {
    setData(url, {'content-type': utils.lookupMimeType(url)}, data);
  } else {
    dataz[url].data = data;
  }
}

function setRequestCallback(callback) {
  requestCb = callback;
}

function registerUrlStatusCode(url, statusCode) {
  this.registerUrl(url, function (options, callback) {
    callback(null, statusCode, '');
  });
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
module.exports.unregisterUrl = unregisterUrl;
module.exports.setUrlData = setUrlData;
module.exports.setRequestCallback = setRequestCallback;
module.exports.registerUrlStatusCode = registerUrlStatusCode;
module.exports.wasUrlRequested = wasUrlRequested;
module.exports.getUrlMethodRequestCount = getUrlMethodRequestCount;
module.exports.printRegisteredUrls = printRegisteredUrls;
module.exports.printRequestedUrls = printRequestedUrls;
module.exports.TestRequest = TestRequest;
module.exports.TestResponse = TestResponse;
