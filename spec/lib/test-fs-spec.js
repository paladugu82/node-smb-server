var fsreq = require('./test-fs');

// sanity tests for the mock FS implementation
describe('MockFSTests', function () {
  var fs;

  function verifyExists(path, exists) {
    var doesExist = true;
    try {
      fs.statSync(path);
    } catch (e) {
      doesExist = false;
    }
    expect(doesExist).toEqual(exists);
  }

  beforeEach(function () {
    fs = new fsreq();
  });

  it('testMkdirp', function (done) {
    fs.mkdirp('/test/subdir', function (err) {
      expect(err).toBeFalsy();
      fs.stat('/test', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        fs.stat('/test/subdir', function (err, stat) {
          expect(err).toBeFalsy();
          expect(stat).toBeTruthy();
          done();
        });
      });
    });
  });

  it('testCreateEntityIfNoExist', function (done) {
    fs.createEntityIfNoExist('/test/noexists.jpg', false, function (err) {
      expect(err).toBeFalsy();
      fs.stat('/test/noexists.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        fs.createEntityIfNoExist('/test/noexists.jpg', false, function (err) {
          expect(err).toBeFalsy();
          done();
        });
      });
    });
  });

  it('testCreateEntityWithDates', function (done) {
    fs.createEntityWithDates('/test/testwithdates.jpg', false, 'file content', 1234, 12345, function (err) {
      expect(err).toBeFalsy();
      fs.stat('/test/testwithdates.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        expect(stat.data).toEqual('file content');
        expect(stat.mtime).toEqual(12345);
        expect(stat.birthtime).toEqual(1234);
        done();
      });
    });
  });

  it('testCreateEntity', function (done) {
    fs.createEntity('/test/createentity.jpg', false, function (err) {
      expect(err).toBeFalsy();
      fs.stat('/test/createentity.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        done();
      });
    });
  });

  it('testOpenRead', function (done) {
    fs.createEntity('/openread.jpg', false, function (err) {
      expect(err).toBeFalsy();
      fs.open('/openread.jpg', 'r', function (err, id) {
        expect(err).toBeFalsy();
        expect(id).toBeDefined();
        done();
      });
    });
  });

  it('testOpenReadNoExist', function (done) {
    fs.open('/openreadnoexist.jpg', 'r', function (err) {
      expect(err).toBeTruthy();
      done();
    });
  });

  it('testOpenWrite', function (done) {
    fs.open('/openwritenoexist.jpg', 'w', function (err, id) {
      expect(err).toBeFalsy();
      expect(id).toBeDefined();
      fs.stat('/openwritenoexist.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        done();
      });
    });
  });

  it('testOpenWriteExist', function (done) {
    fs.createEntity('/openwriteexist.jpg', false, function (err) {
      expect(err).toBeFalsy();
      fs.open('/openwriteexist.jpg', 'w', function (err, id) {
        expect(err).toBeFalsy();
        expect(id).toBeDefined();
        done();
      });
    });
  });

  it('testOpenExistingWrite', function (done) {
    fs.open('/openexistingwrite.jpg', 'wx', function (err, id) {
      expect(err).toBeFalsy();
      expect(id).toBeDefined();
      fs.stat('/openexistingwrite.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        done();
      });
    });
  });

  it('testOpenExistingWriteExists', function (done) {
    fs.createEntity('/openexistingwriteexists.jpg', false, function (err) {
      expect(err).toBeFalsy();
      fs.open('/openexistingwriteexists.jpg', 'wx', function (err) {
        expect(err).toBeTruthy();
        done();
      });
    });
  });

  it('testCreateReadStream', function (done) {
    var date = new Date().getTime();
    fs.createEntityWithDatesSync('/createreadstream.jpg', false, 'hello world', date, date);

    var stream = fs.createReadStream('/createreadstream.jpg');
    expect(stream).toBeTruthy();
    stream.readAll(function (err, data) {
      expect(err).toBeFalsy();
      expect(data).toEqual('hello world');
      done();
    });
  });

  it('testCreateWriteStream', function (done) {
    var stream = fs.createWriteStream('/createwritestream.jpg');
    expect(stream).toBeTruthy();
    stream.on('error', function (err) {
      expect(err).toBeFalsy();
    });
    stream.on('finish', function () {
      var stream = fs.createReadStream('/createwritestream.jpg');
      stream.readAll(function (err, data) {
        expect(err).toBeFalsy();
        expect(data).toEqual('hello world!');
        done();
      });
    });

    stream.write('hello world');
    stream.end('!');
  });

  it('testStat', function (done) {
    fs.stat('/teststat.jpg', function (err, stat) {
      expect(err).toBeTruthy();
      expect(err.code).toEqual('ENOENT');
      expect(stat).toBeFalsy();

      var modified = new Date().getTime();
      var created = modified - 100;

      fs.createEntityWithDates('/teststat.jpg', false, 'content', created, modified, function (err) {
        expect(err).toBeFalsy();
        fs.stat('/teststat.jpg', function (err, stat) {
          expect(err).toBeFalsy();
          expect(stat).toBeTruthy();
          expect(stat.name).toEqual('teststat.jpg');
          expect(stat.mode).toBeTruthy();
          expect(stat.size).toEqual(7);
          expect(stat.birthtime).toEqual(created);
          expect(stat.mtime).toEqual(modified);
          expect(stat.atime).toEqual(modified);
          expect(stat.ctime).toEqual(modified);
          expect(stat.isdir).toEqual(false);
          expect(stat.data).toEqual('content');
          expect(stat.isDirectory()).toBeFalsy();
          expect(stat.isFile()).toBeTruthy();
          stat.mtime = modified + 100;
          expect(stat.mtime).toEqual(modified + 100);
          expect(stat.ctime).toEqual(modified);
          done();
        });
      });
    });
  });

  it('testStatDir', function (done) {
    fs.stat('/teststatdir', function (err, stat) {
      expect(err).toBeTruthy();
      expect(err.code).toEqual('ENOENT');
      expect(stat).toBeFalsy();

      var modified = new Date().getTime();
      var created = modified - 100;
      fs.createEntityWithDatesSync('/teststatdir', true, 'invalid', created, modified);
      fs.stat('/teststatdir', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        expect(stat.name).toEqual('teststatdir');
        expect(stat.mode).toBeTruthy();
        expect(stat.size).toBeFalsy();
        expect(stat.birthtime).toEqual(created);
        expect(stat.mtime).toEqual(modified);
        expect(stat.atime).toEqual(modified);
        expect(stat.ctime).toEqual(modified);
        expect(stat.isdir).toBeTruthy();
        expect(stat.data).toBeUndefined();
        expect(stat.isDirectory()).toBeTruthy();
        expect(stat.isFile()).toBeFalsy();
        stat.mtime = modified + 100;
        expect(stat.mtime).toEqual(modified + 100);
        expect(stat.ctime).toEqual(modified);
        done();
      });
    });
  });

  it('testFstat', function (done) {
    fs.fstat('1', function (err, stat) {
      expect(err).toBeTruthy();
      expect(err.code).toEqual('ENOENT');
      expect(stat).toBeFalsy();

      var fid = fs.createEntitySync('/testfstat.jpg', false);
      fs.fstat(fid, function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat).toBeTruthy();
        expect(stat.name).toEqual('testfstat.jpg');
        done();
      });
    });
  });

  it('testTruncate', function (done) {
    fs.truncate('/truncate.jpg', 100, function (err) {
      expect(err).toBeTruthy();
      fs.createEntitySync('/truncate.jpg', false);
      fs.stat('/truncate.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat.size).toEqual(0);
        fs.truncate('/truncate.jpg', 100, function (err) {
          expect(err).toBeFalsy();
          fs.stat('/truncate.jpg', function (err, stat) {
            expect(err).toBeFalsy();
            expect(stat.size).toEqual(100);
            done();
          });
        });
      });
    });
  });

  it('testWrite', function (done) {
    function verifyData(data, cb) {
      fs.stat('/testwrite.jpg', function (err, stat) {
        expect(err).toBeFalsy();
        expect(stat.data).toEqual(data);
        cb();
      });
    }

    fs.write('1', 'test', 0, 4, 0, function (err) {
      expect(err).toBeTruthy();
      var fid = fs.createEntitySync('/testwrite.jpg', false);
      fs.write(fid, 'test', 0, 4, 0, function (err) {
        expect(err).toBeFalsy();
        verifyData('', function () {
          fs.truncate('/testwrite.jpg', 4, function (err) {
            expect(err).toBeFalsy();
            fs.write(fid, 'test', 0, 4, 0, function (err) {
              expect(err).toBeFalsy();
              verifyData('test', function () {
                fs.write(fid, 'test', 0, 1, 1, function (err) {
                  expect(err).toBeFalsy();
                  verifyData('ttst', function () {
                    fs.write(fid, 'diff', 3, 4, 3, function (err) {
                      expect(err).toBeFalsy();
                      verifyData('ttsf', done);
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

  it('testRead', function (done) {
    var value = 'test';
    fs.read('1', value, 0, 4, 0, function (err) {
      expect(err).toBeTruthy();
      var fid = fs.createEntityWithDatesSync('/testread.jpg', false, 'file', new Date().getTime(), new Date().getTime());
      fs.read(fid, value, 0, 4, 0, function (err, read, result) {
        expect(err).toBeFalsy();
        expect(read).toEqual(4);
        expect(result.toString()).toEqual('file');
        fs.read(fid, 'tes', 0, 4, 0, function (err, read, result) {
          expect(err).toBeFalsy();
          expect(read).toEqual(3);
          expect(result.toString()).toEqual('fil');
          var orig = Buffer.from('test');
          fs.read(fid, orig, 1, 1, 1, function (err, read, result) {
            expect(err).toBeFalsy();
            expect(read).toEqual(1);
            expect(result.toString()).toEqual('i');
            expect(orig.toString()).toEqual('tist');
            fs.read(fid, orig, 0, 100, 1, function (err, read, result) {
              expect(err).toBeFalsy();
              expect(read).toEqual(3);
              expect(result.toString()).toEqual('ile');
              expect(orig.toString()).toEqual('ilet');
              done();
            });
          });
        });
      });
    });
  });

  it('testUnlink', function (done) {
    fs.unlink('/unlink.jpg', function (err) {
      expect(err).toBeTruthy();
      fs.createEntitySync('/unlink.jpg', false);
      fs.unlink('/unlink.jpg', function (err) {
        expect(err).toBeFalsy();
        fs.stat('/unlink.jpg', function (err) {
          expect(err).toBeTruthy();
          done();
        });
      });
    });
  });

  it('testReadDir', function (done) {
    fs.readdir('/readdir', function (err, files) {
      expect(err).toBeTruthy();
      expect(files).toBeFalsy();

      fs.mkdirp('/readdir', function (err) {
        expect(err).toBeFalsy();
        fs.createEntity('/readdir/subdir', true, function (err) {
          expect(err).toBeFalsy();
          fs.createEntity('/readdir/readdir.jpg', false, function (err) {
            expect(err).toBeFalsy();
            fs.createEntity('/readdir/subdir/subsubdir', true, function (err) {
              expect(err).toBeFalsy();
              fs.createEntity('/readdir/subdir/subdir.jpg', false, function (err) {
                expect(err).toBeFalsy();
                fs.readdir('/', function (err, names) {
                  expect(err).toBeFalsy();
                  expect(names.length).toEqual(1);
                  expect(names[0]).toEqual('readdir');

                  fs.readdir('/readdir', function (err, names) {
                    expect(err).toBeFalsy();
                    expect(names.length).toEqual(2);
                    expect(names[0]).toEqual('subdir');
                    expect(names[1]).toEqual('readdir.jpg');

                    fs.readdir('/readdir/subdir', function (err, names) {
                      expect(err).toBeFalsy();
                      expect(names.length).toEqual(2);
                      expect(names[0]).toEqual('subsubdir');
                      expect(names[1]).toEqual('subdir.jpg');

                      fs.readdir('/readdir/subdir/subsubdir', function (err, names) {
                        expect(err).toBeFalsy();
                        expect(names.length).toEqual(0);
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

  it('testRmDir', function (done) {
    fs.rmdir('/rmdir', function (err) {
      expect(err).toBeTruthy();
      fs.createEntity('/rmdir', true, function (err) {
        expect(err).toBeFalsy();
        fs.createEntity('/rmdir.jpg', false, function (err) {
          expect(err).toBeFalsy();
          fs.rmdir('/rmdir', function (err) {
            expect(err).toBeFalsy();
            fs.stat('/rmdir', function (err) {
              expect(err).toBeTruthy();
              fs.rmdir('/rmdir.jpg', function (err) {
                expect(err).toBeTruthy();
                done();
              });
            });
          });
        });
      });
    });
  });

  it('testRmDirNotEmpty', function (done) {
    fs.createEntitySync('/rmdirnotempty', true);
    fs.createEntitySync('/rmdirnotempty/notempty.jpg', false);
    fs.createEntitySync('/rmdirnotempty/subdir', true);
    fs.createEntitySync('/rmdirnotempty/subdir/subdir.jpg', false);
    fs.createEntitySync('/rmdirnotemptyjk');
    fs.rmdir('/rmdirnotempty', function (err) {
      expect(err).toBeTruthy();
      fs.allowDeleteNonEmptyDir(true);
      fs.rmdir('/rmdirnotempty', function (err) {
        expect(err).toBeFalsy();
        verifyExists('/rmdirnotempty', false);
        verifyExists('/rmdirnotempty/notempty.jpg', false);
        verifyExists('/rmdirnotemptyjk', true);
        verifyExists('/rmdirnotempty/subdir', false);
        verifyExists('/rmdirnotempty/subdir/subdir.jpg', false);
        done();
      });
    });
  });

  it('testRename', function (done) {
    fs.rename('/rename', '/rename2', function (err) {
      expect(err).toBeTruthy();
      fs.createEntitySync('/rename', true);
      fs.createEntitySync('/rename/rename.jpg', false);
      fs.createEntitySync('/renamejk', true);
      fs.createEntitySync('/renamejk/renamejk.jpg', false);
      fs.createEntitySync('/renamejk/renamejk1.jpg', false);
      fs.createEntitySync('/rename/subdir', true);
      fs.createEntitySync('/rename/subdir/subdir.jpg', false);
      fs.createEntitySync('/rename3', true);
      fs.createEntitySync('/rename3/subdir3', true);
      fs.createEntitySync('/rename3/subdir3/subdir3.jpg', false);
      fs.rename('/rename', '/rename2', function (err) {
        expect(err).toBeFalsy();
        verifyExists('/rename', false);
        verifyExists('/rename2', true);
        verifyExists('/rename/rename.jpg', false);
        verifyExists('/rename2/rename.jpg', true);
        verifyExists('/renamejk', true);
        verifyExists('/renamejk/renamejk.jpg', true);
        verifyExists('/renamejk/renamejk1.jpg', true);
        verifyExists('/rename/subdir', false);
        verifyExists('/rename2/subdir', true);
        verifyExists('/rename/subdir/subdir.jpg', false);
        verifyExists('/rename2/subdir/subdir.jpg', true);

        fs.rename('/rename2', '/rename3', function (err) {
          expect(err).toBeFalsy();
          verifyExists('/rename3', true);
          verifyExists('/rename3/rename.jpg', true);
          verifyExists('/rename3/subdir3', false);
          verifyExists('/rename3/subdir3/subdir3.jpg', false);

          fs.rename('/renamejk/renamejk.jpg', '/renamejk/renamejk1.jpg', function (err) {
            expect(err).toBeFalsy();
            verifyExists('/renamejk/renamejk.jpg', false);
            verifyExists('/renamejk/renamejk1.jpg', true);
            done();
          });
        });
      });
    });
  });

  it('testRegisterPath', function (done) {
    fs.registerPath('/testregistered.txt', function (path, data, callback) {
      expect(path).toEqual('/testregistered.txt');
      callback(null, data + ' World!');
    });
    fs.createEntityWithDatesSync('/testregistered.txt', false, 'Hello', new Date().getTime(), new Date().getTime());

    var finished = false;
    var write = fs.createWriteStream('/testregistered_w.txt');
    var read = fs.createReadStream('/testregistered.txt');
    read.pipe(write);

    write.on('finish', function () {
      expect(write.getWritten()).toEqual('Hello World!');
      expect(finished).toBeTruthy();
      done();
    });

    write.on('error', function (err) {
      expect(false).toBeTruthy();
    });

    read.on('end', function () {
      finished = true;
    });

    read.on('error', function (err) {
      expect(false).toBeTruthy();
    });
  });

  it('testRegisterPathError', function (done) {
    fs.registerPath('/testregisterederr.txt', function (path, data, callback) {
      callback('There was an error!');
    });
    fs.createEntitySync('/testregisterederr.txt', false);

    var write = fs.createWriteStream('/testregisterederr_w.txt');
    var read = fs.createReadStream('/testregisterederr.txt');
    read.pipe(write);

    write.on('finish', function () {
      expect(false).toBeTruthy();
    });

    write.on('error', function (err) {
      expect(false).toBeTruthy();
    });

    read.on('end', function () {
      expect(false).toBeTruthy();
    });

    read.on('error', function (err) {
      expect(err).toBeTruthy();
      done();
    });
  });
});
