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

  it('testGetLinkedAssets', function (done) {
    var callback = function (err, assets) {
      expect(err).toBeFalsy();
      expect(assets).toBeTruthy();
      expect(assets.length).toEqual(2);
      expect(assets[0]).toEqual('file:///Volumes/DAM/we-retail/en/activities/biking/cycling_1.jpg');
      expect(assets[1]).toEqual('file:///Volumes/DAM/we-retail/en/activities/biking/cycling_2.jpg');
      done();
    };

    c.request.registerUrl(RQCommon.getHostRemotePrefix() + '/content/dam/testindesign.indd/jcr:content/metadata/xmpMM:Ingredients.1.json', function (url, headers, cb) {
      cb(null, 200, '{"jcr:primaryType":"nt:unstructured","xmpNodeType":"xmpArray","xmpArraySize":2,"xmpArrayType":"rdf:Bag","1":{"jcr:primaryType":"nt:unstructured","stRef:filePath":"file:///Volumes/DAM/we-retail/en/activities/biking/cycling_1.jpg","stRef:instanceID":"xmp.iid:a2b73b7d-7b74-4c04-97e4-d219a148eead","stRef:maskMarkers":"None","stRef:toPart":"/","stRef:placedResolutionUnit":"Inches","stRef:linkCategory":"Content","stRef:linkForm":"ReferenceStream","xmpNodeType":"xmpStruct","stRef:placedYResolution":"300.00","stRef:documentID":"xmp.did:a2b73b7d-7b74-4c04-97e4-d219a148eead","stRef:fromPart":"/","stRef:placedXResolution":"300.00"},"2":{"jcr:primaryType":"nt:unstructured","stRef:filePath":"file:///Volumes/DAM/we-retail/en/activities/biking/cycling_2.jpg","stRef:instanceID":"xmp.iid:f13e7a82-e18b-48fd-bc67-e08bc04e22a3","stRef:maskMarkers":"None","stRef:toPart":"/","stRef:placedResolutionUnit":"Inches","stRef:linkCategory":"Content","stRef:linkForm":"ReferenceStream","xmpNodeType":"xmpStruct","stRef:placedYResolution":"300.00","stRef:documentID":"xmp.did:f13e7a82-e18b-48fd-bc67-e08bc04e22a3","stRef:fromPart":"/","stRef:placedXResolution":"300.00"}}');
    });

    c.testShare.emit('getlinkedassets', {context: c.testContext, options: {path: '/testindesign.indd'}, callback: callback});
  });
});
