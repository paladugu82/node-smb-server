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

var RQCommon = require('./rq-common');

describe('RQShare', function () {
  var c;

  beforeEach(function () {
    c = new RQCommon();
  });

  describe('Events', function () {
    it('testDownloadAssetEvent', function (done) {
      c.addFile(c.remoteTree, '/testdownload.jpg', function () {
        c.expectLocalFileExist('/testdownload.jpg', false, false, function () {
          c.testShare.on('shareEvent', function (data) {
            if (data.event == 'downloadend') {
              // there are timing issues between the completion of the request and when this event is emitted. Set a
              // timeout to allow the download to finish up
              setTimeout(function () {
                c.expectLocalFileExist('/testdownload.jpg', true, false, function () {
                  c.expectQueuedMethod('/', 'testdownload.jpg', false, done);
                });
              }, 500);
            }
          });
          c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/testdownload.jpg'});
        });
      });
    });
  });

  it('testDownloadAssetExists', function (done) {
    c.addCachedFile('/testexists.jpg', function () {
      var eventCalled = false;
      c.testShare.on('shareEvent', function () {
        eventCalled = true;
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/testexists.jpg'});
      setTimeout(function () {
        expect(eventCalled).toBeFalsy();
        done();
      }, 500);
    });
  });

  it('testUploadAssetEvent', function (done) {
    c.addQueuedFile('/testupload.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'syncfileend') {
            // there's a sync issue because the processor hasn't finished yet. give the processor time to finish
            // so that the file won't be queued
          setTimeout(function () {
            c.expectLocalFileExist('/testupload.jpg', true, false, function () {
              c.expectQueuedMethod('/', 'testupload.jpg', false, function () {
                c.remoteTree.exists('/testupload.jpg', function (err, exists) {
                  expect(err).toBeFalsy();
                  expect(exists).toBeTruthy();
                  done();
                });
              });
            });
          }, 100);
        }
      });
      c.testShare.onServerEvent(c.testContext, 'uploadasset', {path: '/testupload.jpg'});
    });
  });

  it('testCancelUpload', function (done) {
    c.addQueuedFile('/testcancel.jpg', function () {
      c.registerLocalPath('/testcancel.jpg', function (filePath, fileData, fileCb) {
        c.testShare.onServerEvent(c.testContext, 'cancelupload', {path: '/testcancel.jpg'});
        fileCb(null, fileData);
      });
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'syncfileabort') {
          c.remoteTree.exists('/testcancel.jpg', function (err, exists) {
            expect(err).toBeFalsy();
            expect(exists).toBeFalsy();
            c.expectLocalFileExist('/testcancel.jpg', true, true, function () {
              c.expectQueuedMethod('/', 'testcancel.jpg', 'PUT', done);
            });
          });
        }
      });
      c.testShare.onServerEvent(c.testContext, 'uploadasset', {path: '/testcancel.jpg'});
    });
  });

  it('testNetworkLoss', function (done) {
    c.addFile(c.remoteTree, '/networkloss.jpg', function () {
      c.registerUrl('/networkloss.jpg', function (options, cb) {
        cb('there was an error!');
      });
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'networkloss') {
          c.expectLocalFileExist('/networkloss500.jpg', false, false, done);
        }
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkloss.jpg'});
    });
  });

  it('testNetworkLoss500', function (done) {
    c.addFile(c.remoteTree, '/networkloss500.jpg', function () {
      c.registerUrl('/networkloss500.jpg', function (options, cb) {
        cb(null, 500);
      });
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'networkloss') {
          expect(false).toBeTruthy();
        }
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkloss500.jpg'}, function (err) {
        expect(err).toBeTruthy();
        c.expectLocalFileExist('/networkloss500.jpg', false, false, done);
      });
    });
  });

  it('testNetworkLoss501', function (done) {
    var loss = false;
    c.addFile(c.remoteTree, '/networkloss501.jpg', function () {
      c.registerUrl('/networkloss501.jpg', function (options, cb) {
        cb(null, 501);
      });
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'networkloss') {
          loss = true;
        }
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkloss501.jpg'}, function (err) {
        expect(err).toBeTruthy();
        expect(loss).toBeTruthy();
        c.expectLocalFileExist('/networkloss501.jpg', false, false, done);
      });
    });
  });

  it('testNetworkRestored', function (done) {
    var eventCalls = {};
    c.addFile(c.remoteTree, '/networkrestored.jpg', function () {
      c.registerUrl('/networkrestored.jpg', function (options, cb) {
        // lose the network only on the first run
        c.unregisterUrl('/networkrestored.jpg');
        cb('network lost!');
      });
      c.testShare.on('shareEvent', function (data) {
        if (!eventCalls[data.event]) {
          eventCalls[data.event] = 0;
        }
        eventCalls[data.event]++;
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkrestored.jpg'}, function (err) {
        expect(err).toBeTruthy();
        expect(eventCalls['networkloss']).toEqual(1);
        expect(eventCalls['networkrestored']).toBeFalsy();

        c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkrestored.jpg'}, function (err) {
          expect(err).toBeFalsy();
          expect(eventCalls['networkloss']).toEqual(1);
          expect(eventCalls['networkrestored']).toEqual(1);

          c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networkrestored.jpg'}, function (err) {
            expect(err).toBeFalsy();
            expect(eventCalls['networkloss']).toEqual(1);
            expect(eventCalls['networkrestored']).toEqual(1);
            done();
          });
        });
      });
    });
  });

  it('testNetworkNoRestored', function (done) {
    c.addFile(c.remoteTree, '/networknorestored.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'networkrestored') {
          expect(false).toBeTruthy();
        }
      });
      c.testShare.onServerEvent(c.testContext, 'downloadasset', {path: '/networknorestored.jpg'}, function (err) {
        expect(err).toBeFalsy();
        done();
      });
    });
  });

  describe('CustomHeaderTests', function () {
    it('testCustomConfigHeaders', function (done) {
      var statusCode = 201;
      c.registerUrl('/testconfig.jpg', function (options, cb) {
        var currCode = statusCode;
        statusCode = 200;
        expect(options.headers['user-agent']).toBeTruthy();
        if (currCode == 200) {
          expect(options.headers['x-smbserver-action']).toEqual('downloadfile');
        } else {
          expect(options.headers['x-smbserver-action']).toEqual('createfile');
        }
        cb(null, currCode, 'testconfig');
      });
      c.addCachedFile('/testconfig.jpg', function () {
        done();
      });
    });
  });
});
