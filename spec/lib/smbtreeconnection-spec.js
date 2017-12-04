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

var SMBContext = require('../../lib/smbcontext');
var SMBTreeConnection = require('../../lib/smbtreeconnection');
var SMBTree = require('../../lib/smbtree');
var SPITreeConnection = require('../../lib/spi/treeconnection');
var SPITree = require('../../lib/spi/tree');
var SPIFileConnection = require('../../lib/spi/fileconnection');
var SPIFile = require('../../lib/spi/file');
var common = require('../../lib/common');

describe('SMBTreeConnection', function () {
  var treeConnection, smbTree, spiTreeConnection, spiTree, spiFileConnection, spiFile, context;

  beforeEach(function () {
    SPIFile.prototype.isDirectory = function () {
      return false;
    }
    SPIFile.prototype.isFile = function () {
      return true;
    }
    SPIFile.prototype.isHidden = function () {
      return false;
    }
    SPIFile.prototype.isReadOnly = function () {
      return false;
    }
    context = new SMBContext().withLabel('unittests');
    treeConnection = new SMBTreeConnection();
    spiTreeConnection = new SPITreeConnection({});
    spiTree = new SPITree(spiTreeConnection, context);
    spiFileConnection = new SPIFileConnection('/testfile', spiTree);
    spiFile = new SPIFile(spiFileConnection);
    smbTree = new SMBTree(treeConnection, spiTree, context);
  });

  /**
   * FID's can only be withing a certain range. Test to make sure that they stay in that range. In addition, FIDs that
   * are already in use should not be reused, so make sure they remain unique.
   */
  it('testFileIdRollover', function () {
    var file = treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
    expect(file.fid).toEqual(common.MIN_FID);

    // clear the file and overflow the queue
    treeConnection.clearFile(common.MIN_FID);

    for (var i = 0; i < common.MAX_FID; i++) {
      var newFile = treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
      if (i == common.MAX_FID - 1) {
        // the last one should have rolled over
        expect(newFile.fid).toEqual(common.MIN_FID);
      } else {
        expect(newFile.fid).toEqual(i + 2);
      }
    }

    // file queue is full at this point
    var threw = false;
    try {
      treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBeTruthy();

    // clear one in the middle and try to use it
    treeConnection.clearFile(500);
    file = treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
    expect(file.fid).toEqual(500);

    // clear the first one and try to use it
    treeConnection.clearFile(common.MIN_FID);
    file = treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
    expect(file.fid).toEqual(common.MIN_FID);

    // clear the last one
    treeConnection.clearFile(common.MAX_FID);
    file = treeConnection.createFileInstance(smbTree, spiFile, common.FILE_OPENED);
    expect(file.fid).toEqual(common.MAX_FID);
  });
});
