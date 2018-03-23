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
var RQTree = RQCommon.require(__dirname, '../../../../lib/backends/rq/tree');
var utils = RQCommon.require(__dirname, '../../../../lib/utils');

describe('RQTreeConnection', function () {
  var c;

  beforeEach(function () {
    c = new RQCommon();
  });

  it('testDownloadAsset', function (done) {
    c.addFile(c.remoteTree, '/download.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'downloadend') {
          setTimeout(function () {
            c.expectLocalFileExist('/download.jpg', true, false, done);
          }, 500);
        }
      });
      c.testShare.emit('downloadasset', {path: '/download.jpg', context: c.testContext});
    });
  });
  
  it('testDownloadAssetExisting', function (done) {
    c.addCachedFile('/existing.jpg', function () {
      var sent = false;
      c.testShare.on('shareEvent', function () {
        sent = true;
      });
      c.testShare.emit('downloadasset', {path: '/existing.jpg', context: c.testContext});
      setTimeout(function () {
        expect(sent).toBeFalsy();
        done();
      }, 500);
    });
  });

  it('testDownloadAssetExistingOpen', function (done) {
    c.addCachedFile('/existing.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'openasset') {
          expect(data.data.path).toEqual('/existing.jpg');
          done();
        }
      });
      c.testShare.emit('downloadasset', {path: '/existing.jpg', openIfExists: true, context: c.testContext});
    });
  });

  it('testDownloadAssetExistingForce', function (done) {
    c.addCachedFile('/existing.jpg', function () {
      c.testShare.on('shareEvent', function (data) {
        if (data.event == 'downloadend') {
          setTimeout(function () {
            c.expectLocalFileExist('/existing.jpg', true, false, done);
          }, 500);
        }
      });
      c.testShare.emit('downloadasset', {path: '/existing.jpg', force: true, context: c.testContext});
    });
  });
});
