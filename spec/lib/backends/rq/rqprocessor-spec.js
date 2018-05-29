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
var RQProcessor = RQCommon.require(__dirname, '../../../../lib/backends/rq/rqprocessor');
var RequestQueue = RQCommon.require(__dirname, '../../../../lib/backends/rq/requestqueue');
var Path = require('path');
var URL = require('url');

describe('RQProcessor', function () {
  var processor, c, rq, config;

  function expectSyncEvent(eventName, eventData) {
    c.expectShareEvent(eventName, eventData);
  }

  function expectNotSyncEvent(eventName, eventData) {
    c.expectNotShareEvent(eventName, eventData);
  }

  beforeEach(function () {
    c = new RQCommon();

    processor = new RQProcessor(c.testTreeConnection);

    config = {
      expiration: 0,
      maxRetries: 3,
      retryDelay: 200,
      frequency: 500
    };

    spyOn(processor, 'emit').andCallThrough();
  });

  describe('RQUpdated', function () {
    it('testItemUpdatedUploading', function (done) {
      var canceled = false;
      c.addQueuedFile('/testfile', function () {
        c.registerLocalPath('/testfile', function (filePath, fileData, localCb) {
          if (!canceled) {
            canceled = true;
            c.testTree.rq.queueRequest(c.testContext, {
              method: 'POST',
              path: '/testfile',
              localPrefix: c.localPrefix,
              remotePrefix: c.hostPrefix
            }, function (err) {
              expect(err).toBeFalsy();
              localCb(null, fileData);
            });
          } else {
            localCb(null, fileData);
          }
        });
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          expectSyncEvent('syncfilestart', {path: '/testfile', method: 'POST'});
          expectSyncEvent('syncfileabort', {path: '/testfile'});
          expectNotSyncEvent('syncfileend', {path: '/testfile', method: 'POST'});
          expectNotSyncEvent('syncfileerr', {path: '/testfile', method: 'POST', err: jasmine.any(String)});
          done();
        });
      });
    });

    it('testItemUpdatedNotUploading', function (done) {
      c.addQueuedFile('/testfile', function () {
        c.testTree.rq.queueRequest(c.testContext, {
          method: 'POST',
          path: '/testfile',
          localPrefix: c.localPrefix,
          remotePrefix: c.hostPrefix
        }, function (err) {
          expect(err).toBeFalsy();
          c.expectQueuedMethod('/', 'testfile', 'PUT', function () {
            expectNotSyncEvent('syncfileabort', {path: '/testfile'});
            done();
          });
        });
      });
    });

    var testPathUpdated = function (path, removePath, done) {
      c.addQueuedFile(path, function () {
        c.registerLocalPath(path, function (filePath, fileData, fileCb) {
          c.testTree.rq.removePath(c.testContext, removePath, function (err) {
            expect(err).toBeFalsy();
            fileCb(null, fileData);
          });
        });
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          expectSyncEvent('syncfileabort', {path: path});
          expectNotSyncEvent('syncfileend', {path: path, method:'POST'});
          done();
        });
      });
    };

    it('testPathUpdatedUploading', function (done) {
      testPathUpdated('/testfile', '/', done);
    });

    it('testPathUpdatedUploadingSubPath', function (done) {
      testPathUpdated('/dir/testfile', '/', done);
    });

    it('testPathUpdatedUploadingSubPathNotRoot', function (done) {
      testPathUpdated('/dir/testfile', '/dir', done);
    });
  });

  describe('Sync', function () {
    var testDotFile = function (path, name, done) {
      c.registerUrl(Path.join(path, name) + '.json', function (options, cb) {
        cb(null, 200);
      });
      c.testTree.rq.getProcessRequest = function (context, expiration, maxRetries, cb) {
        cb(null, {
          path: path,
          name: name,
          method: 'DELETE',
          remotePrefix: c.hostPrefix,
          localPrefix: c.localPrefix
        });
      };
      c.testTree.rq.completeRequest = function (context, path, name, cb) {
        c.testTree.rq.getProcessRequest = function (context, expiration, maxRetries, getCb) {
          getCb();
        };
        cb();
      };
      processor.sync(config, function (err) {
        expect(err).toBeFalsy();
        expectSyncEvent('syncfileerr', {path: Path.join(path, name), method: 'DELETE', err: jasmine.any(String)});
        done();
      });
    };

    var addLocalCachedFile = function (path, cb) {
      c.addRemoteFileWithContent(path, 'remote content', function () {
        c.testTree.open(path, function (err, file) {
          expect(err).toBeFalsy();
          file.cacheFile(function (err) {
            expect(err).toBeFalsy();
            cb(file);
          });
        });
      });
    };

    it('testSyncCreate', function (done) {
      c.addQueuedFile('/testfile', function () {
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          c.expectLocalFileExist('/testfile', true, false, function () {
            c.expectQueuedMethod('/', 'testfile', false, function () {
              expectSyncEvent('syncfilestart', {path: '/testfile', method: 'POST'});
              expectSyncEvent('syncfileprogress', {path: '/testfile', read: jasmine.any(Number), total: jasmine.any(Number), rate: jasmine.any(Number), elapsed: jasmine.any(Number)});
              expectSyncEvent('syncfileend', {path: '/testfile', method: 'POST'});
              done();
            });
          });
        });
      });
    });

    it('testSyncMultiple', function (done) {
      c.addQueuedFile('/testfile', function () {
        c.addQueuedFile('/testfile2', function () {
          processor.sync(config, function (err) {
            expect(err).toBeFalsy();
            c.expectLocalFileExist('/testfile', true, false, function () {
              c.expectLocalFileExist('/testfile2', true, false, function () {
                c.expectQueuedMethod('/', 'testfile', false, function () {
                  c.expectQueuedMethod('/', 'testfile2', false, function () {
                    expectSyncEvent('syncfileend', {path: '/testfile', method: 'POST'});
                    expectSyncEvent('syncfileend', {path: '/testfile2', method: 'POST'});
                    done();
                  });
                });
              });
            });
          });
        });
      });
    });

    it('testSyncUpdate', function (done) {
      addLocalCachedFile('/testfile', function (file) {
        file.setLength(100, function (err) {
          expect(err).toBeFalsy();
          file.close(function (err) {
            expect(err).toBeFalsy();
            processor.sync(config, function (err) {
              expect(err).toBeFalsy();
              c.expectQueuedMethod('/', 'testfile', false, function () {
                expectSyncEvent('syncfilestart', {path: '/testfile', method: 'PUT'});
                expectSyncEvent('syncfileprogress', {path: '/testfile', read: jasmine.any(Number), total: jasmine.any(Number), rate: jasmine.any(Number), elapsed: jasmine.any(Number)});
                expectSyncEvent('syncfileend', {path: '/testfile', method: 'PUT'});
                done();
              });
            });
          });
        });
      });
    });

    it('testSyncDelete', function (done) {
      addLocalCachedFile('/testfile', function (file) {
        c.testTree.delete('/testfile', function (err) {
          expect(err).toBeFalsy();
          processor.sync(config, function (err) {
            expect(err).toBeFalsy();
            c.expectQueuedMethod('/', 'testfile', false, function () {
              expectSyncEvent('syncfilestart', {path: '/testfile', method: 'DELETE'});
              expectNotSyncEvent('syncfileprogress', {path: '/testfile', read: jasmine.any(Number), total: jasmine.any(Number), rate: jasmine.any(Number)});
              expectSyncEvent('syncfileend', {path: '/testfile', method: 'DELETE'});
              done();
            });
          });
        });
      });
    });

    it('testSyncDotFile', function (done) {
      testDotFile('/', '.badfile', done);
    });

    it('testSyncDotFolder', function (done) {
      testDotFile('/.badfolder', 'testfile', done);
    });

    it('testSyncErrorStatusCode', function (done) {
      c.registerPathStatusCode('/testfile', 500);
      c.addQueuedFile('/testfile', function (file) {
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          c.expectQueuedMethod('/', 'testfile', 'PUT', function () {
            expectSyncEvent('syncfileerr', {path: '/testfile', method: 'POST', err: jasmine.any(String)});
            c.testTree.rq.queueRequest(c.testContext, {
              method: 'DELETE',
              path: '/testfile',
              localPrefix: c.localPrefix,
              remotePrefix: c.hostPrefix
            }, function (err) {
              expect(err).toBeFalsy();
              expectNotSyncEvent('syncfileabort', {path:any(String)});
              done();
            });
          });
        });
      });
    });

    it('testSyncCheckedOut', function (done) {
      c.registerPathStatusCode('/testfile', 423);
      c.addQueuedFile('/testfile', function (file) {
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          c.expectQueuedMethod('/', 'testfile', false, function () {
            expectSyncEvent('syncfileerr', {path: '/testfile', method: 'POST', err: jasmine.any(String)});
            done();
          });
        });
      });
    });

    it('testSyncCheckedOutConflict', function (done) {
      // simulate a save operation that moves the file. test the case where the api does not enforce the checkout
      // flag. ensure that an error is thrown on sync and that the file is in conflict afterward.
      c.addCachedFile('/testcheckoutconflict.jpg', function () {
        c.setRemoteFileCheckedOut('/testcheckoutconflict.jpg', true, function () {
          c.testTree.rename('/testcheckoutconflict.jpg', '/testcheckoutconflict2.jpg', function (err) {
            expect(err).toBeFalsy();
            c.testTree.rename('/testcheckoutconflict2.jpg', '/testcheckoutconflict.jpg', function (err) {
              expect(err).toBeFalsy();
              c.expectQueuedMethod('/', 'testcheckoutconflict.jpg', 'POST', function () {
                c.expectQueuedMethod('/', 'testcheckoutconflict2.jpg', false, function () {
                  processor.sync(config, function (err) {
                    c.expectQueuedMethod('/', 'testcheckoutconflict.jpg', false, function () {
                      expectSyncEvent('syncfileerr', {path: '/testcheckoutconflict.jpg', method: 'PUT', err: jasmine.any(String)});
                      c.testTree.open('/testcheckoutconflict.jpg', function (err, file) {
                        expect(err).toBeFalsy();
                        file.setLength(10, function (err) {
                          expect(err).toBeFalsy();
                          expectSyncEvent('syncconflict', {path: '/testcheckoutconflict.jpg'});
                          done();
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    it('testSyncEncoded', function (done) {
      var remoteEncodedName = '/%EC%9D%B4%EB%91%90%E5%90%8F%E8%AE%80.jpg';
      var remoteFileName = decodeURI(remoteEncodedName);
      var localFileNameOnly = decodeURI('%E1%84%8B%E1%85%B5%E1%84%83%E1%85%AE%E5%90%8F%E8%AE%80.jpg');
      var localFileName = '/' + localFileNameOnly;
      c.addFile(c.remoteTree, remoteFileName, function () {
        c.addFile(c.localTree, localFileName, function () {
          c.testTree.open(localFileName, function (err, rqFile) {
            expect(err).toBeFalsy();
            rqFile.setLength(10, function (err) {
              expect(err).toBeFalsy();
              rqFile.close(function (err) {
                expect(err).toBeFalsy();
                processor.sync(config, function (err) {
                  expect(err).toBeFalsy();
                  expect(c.wasPathRequested(remoteEncodedName)).toBeTruthy();
                  c.expectQueuedMethod('/', localFileNameOnly, false, done);
                });
              });
            });
          });
        });
      });
    });

    it('testSyncNoExist', function (done) {
      c.registerPathStatusCode('/testfile', 404);
      c.addQueuedFile('/testfile', function () {
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          c.expectQueuedMethod('/', 'testfile', 'PUT', function () {
            expectSyncEvent('syncfileerr', { path: '/testfile', method: 'POST', err: jasmine.any(String) });
            done();
          });
        });
      });
    });

    it('testSyncDates', function (done) {
      c.addFile(c.remoteTree, '/test', function () {
        c.testTree.open('/test', function (err, file) {
          expect(err).toBeFalsy();
          var lastModified = file.lastModified();
          file.write('hello', 0, function (err) {
            expect(err).toBeFalsy();
            setTimeout(function () {
              file.setLastModified(new Date().getTime());
              file.close(function (err) {
                expect(err).toBeFalsy();
                processor.sync(config, function (err) {
                  expect(err).toBeFalsy();
                  c.testTree.open('/test', function (err, newFile) {
                    expect(err).toBeFalsy();
                    expect(file.created()).toEqual(newFile.created());
                    expect(file.lastModified()).toEqual(newFile.lastModified());
                    expect(file.lastChanged()).toEqual(newFile.lastChanged());
                    done();
                  });
                });
              });
            }, 10);
          });
        });
      });
    });


    it('testCacheFileAfterSync', function (done) {
      c.addQueuedFile('/testfile', function () {
        processor.sync(config, function (err) {
          expect(err).toBeFalsy();
          expect(c.getCreateAssetRequestCount('/')).toEqual(1);
          c.testTree.open('/testfile', function (err, file) {
            expect(err).toBeFalsy();
            file.cacheFile(function (err) {
              expect(err).toBeFalsy();
              expect(c.getPathMethodRequestCount('/testfile', 'GET')).toEqual(0);
              done();
            });
          });
        });
      });
    });

    it('testSyncCreateAlreadyExists', function (done) {
      c.addQueuedFile('/testduplicate.jpg', function () {
        c.addFile(c.remoteTree, '/testduplicate.jpg', function () {
          processor.sync(config, function (err) {
            expect(err).toBeFalsy();
            expect(c.getCreateAssetRequestCount('/')).toEqual(1);
            c.expectLocalFileExist('/testduplicate.jpg', true, false, function () {
              c.remoteTree.exists('/testduplicate.jpg', function (err, exists) {
                expect(err).toBeFalsy();
                expect(exists).toBeTruthy();
                done();
              });
            });
          });
        });
      });
    });

    it('testSyncUpdateNoExist', function (done) {
      c.addLocallyModifiedFile('/testnoexist.jpg', function () {
        c.remoteTree.delete('/testnoexist.jpg', function () {
          processor.sync(config, function (err) {
            expect(err).toBeFalsy();
            expect(c.getCreateAssetRequestCount('/')).toEqual(1);
            c.expectLocalFileExist('/testnoexist.jpg', true, false, function () {
              c.remoteTree.exists('/testnoexist.jpg', function (err, exists) {
                expect(err).toBeFalsy();
                expect(exists).toBeTruthy();
                done();
              });
            });
          });
        });
      });
    });

    it('testSyncDeleteNoExist', function (done) {
      c.addCachedFile('/testnoexist.jpg', function () {
        c.testTree.delete('/testnoexist.jpg', function (err) {
          expect(err).toBeFalsy();
          c.remoteTree.delete('/testnoexist.jpg', function (err) {
            expect(err).toBeFalsy();
            processor.sync(config, function (err) {
              expect(err).toBeFalsy();
              expect(c.getDeleteRequestCount('/testnoexist.jpg')).toEqual(1);
              c.expectLocalFileExist('/testnoexist.jpg', false, false, function () {
                c.remoteTree.exists('/testnoexist.jpg', function (err, exists) {
                  expect(err).toBeFalsy();
                  expect(exists).toBeFalsy();
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('SyncPath', function () {
    it('testSyncPath', function (done) {
      c.addQueuedFile('/testfilepath', function () {
        processor.syncPath('/testfilepath', {
          remotePrefix: RQCommon.getFullRemotePrefixWithPath(),
          localPrefix: RQCommon.getLocalPrefix()
        }, function (err) {
          expect(err).toBeFalsy();
          expect(c.getCreateAssetRequestCount('/')).toEqual(1);
          c.expectLocalFileExist('/testfilepath', true, false, function () {
            c.expectQueuedMethod('/', 'testfilepath', false, done);
          });
        });
      });
    });

    it('testSyncPathNotQueued', function (done) {
      c.addCachedFileWithLength('/notqueued.jpg', 10, function () {
        processor.syncPath('/notqueued.jpg', {
          remotePrefix: RQCommon.getFullRemotePrefixWithPath(),
          localPrefix: RQCommon.getLocalPrefix()
        },
        function (err) {
          expect(err).toBeFalsy();
          expect(c.getCreateAssetRequestCount('/')).toEqual(1);
          c.expectLocalFileExist('/notqueued.jpg', true, false, function () {
            c.expectQueuedMethod('/', 'notqueued.jpg', false, done);
          });
        });
      });
    });

    it('testSyncPathDelete', function (done) {
      c.addFile(c.remoteTree, '/testdelete.jpg', function () {
        processor.syncPath('/testdelete.jpg', {
          remotePrefix: RQCommon.getFullRemotePrefixWithPath(),
          localPrefix: RQCommon.getLocalPrefix(),
          isDelete: true
        }, function (err) {
          expect(err).toBeFalsy();
          expect(c.getDeleteRequestCount('/testdelete.jpg')).toEqual(1);
          c.expectLocalFileExist('/testdelete.jpg', false, false, function () {
            c.expectQueuedMethod('/', 'testdelete.jpg', false, done);
          });
        });
      });
    });

    it('testSyncPathQueuedWrongDelete', function (done) {
      c.addQueuedFile('/testqueued.jpg', function () {
        processor.syncPath('/testqueued.jpg', {
          remotePrefix: RQCommon.getFullRemotePrefixWithPath(),
          localPrefix: RQCommon.getLocalPrefix(),
          isDelete: true
        }, function (err) {
          expect(err).toBeFalsy();
          expect(c.getCreateAssetRequestCount('/')).toEqual(1);
          c.expectLocalFileExist('/testqueued.jpg', true, false, function () {
            c.expectQueuedMethod('/', 'testqueued.jpg', false, done);
          });
        });
      });
    });
  });

  describe('StartStop', function () {
    it('testStartStop', function (done) {
      c.addQueuedFile('/testfile', function (file) {
        c.addCachedFile('/testdelete', function () {
          c.testTree.delete('/testdelete', function (err) {
            expect(err).toBeFalsy();
            c.testTree.rq.incrementRetryCount(c.testContext, '/', 'testdelete', 400, function (err) {
              expect(err).toBeFalsy();
              processor.start(config);
              setTimeout(function () {
                processor.stop();
                expectSyncEvent('syncfilestart', {path: '/testfile', method: 'POST'});
                expectSyncEvent('syncfileend', {path: '/testfile', method: 'POST'});
                expectSyncEvent('syncfilestart', {path: '/testdelete', method: 'DELETE'});
                expectSyncEvent('syncfileend', {path: '/testdelete', method: 'DELETE'});
                done();
              }, 1000);
            });
          });
        });
      });
    });

    it('testStartStopPurgeRequests', function (done) {
      c.addQueuedFile('/testfile', function (file) {
        config.maxRetries = 0;
        processor.start(config);
        setTimeout(function () {
          processor.stop();
          expect(processor.emit).toHaveBeenCalledWith('purged', any(Object));
          expectNotSyncEvent('syncfilestart', any(Object));
          done();
        }, 200);
      });
    });

    it('testStartStopCancelRequest', function (done) {
      c.addQueuedFile('/testfile', function (file) {
        c.registerLocalPath('/testfile', function (filePath, fileData, fileCb) {
          c.testShare.disconnect(function () {
            processor.stop();
            fileCb(null, fileData);
            expectSyncEvent('syncfileabort', {path: '/testfile'});
            done();
          });
        });
        processor.start(config);
      });
    });
  });
});
