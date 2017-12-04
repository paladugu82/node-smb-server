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

var lock = require('../../lib/lock');
var SMBContext = require('../../lib/smbcontext');

describe('Lock', function () {
  var context;

  beforeEach(function () {
    context = new SMBContext();
  });

  it('testWriteLock', function (done) {
    var released = false;
    lock.writeLock(context, '/testkey', function (release) {
      setTimeout(function () {
        released = true;
        release();
      }, 500);
    });
    lock.writeLock(context, '/testkey', function (release) {
      expect(released).toBeTruthy();
      release();
      done();
    });
  });

  it('testWriteLockRead', function (done) {
    var released = false;
    lock.writeLock(context, '/testkey2', function (release) {
      setTimeout(function () {
        released = true;
        release();
      }, 500);
    });

    lock.readLock(context, '/testkey2', function (release) {
      expect(released).toBeTruthy();
      release();
      done();
    });
  });

  it('testReadLock', function (done) {
    var released = 0;
    lock.readLock(context, '/testkey3', function (release) {
      setTimeout(function () {
        released++;
        release();
      }, 500);
    });

    lock.readLock(context, '/testkey3', function (release) {
      expect(released < 3).toBeTruthy();
      released++;
      release();
    });

    lock.readLock(context, '/testkey3', function (release) {
      expect(released < 3).toBeTruthy();
      released++;
      release();
    });

    lock.writeLock(context, '/testkey3', function (release) {
      expect(released).toEqual(3);
      release();
      done();
    });
  });

  it('testWriteLockDifferentKey', function (done) {
    var released = false;
    lock.writeLock(context, '/testkey4', function (release) {
      setTimeout(function () {
        released = true;
        release();
        done();
      }, 500);
    });

    lock.writeLock(context, '/testkey5', function (release) {
      expect(released).toBeFalsy();
      release();
    });
  });

  it('testReadLockDifferentKey', function (done) {
    var released = false;
    lock.readLock(context, '/testkey6', function (release) {
      setTimeout(function () {
        released = true;
        release();
        done();
      }, 500);
    });

    lock.writeLock(context, '/testkey7', function (release) {
      expect(released).toBeFalsy();
      release();
    });
  });
});
