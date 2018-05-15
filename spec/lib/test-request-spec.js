var requestreq = require('./test-request');
var fsreq = require('./test-fs');
var stream = require('./test-stream');

// sanity tests for mock request module
describe('MockRequestTests', function () {
  var fs, request, events;

  beforeEach(function () {
    fs = new fsreq();
    requestreq.clearAll();
    request = requestreq.request;
    events = [];
  });

  function captureEvents(req, stream) {
    events = [];
    req.on('end', function () {
      events.push({type: 'request', name: 'end'});
    });

    req.on('finish', function () {
      events.push({type: 'request', name: 'finish'});
    });

    req.on('error', function (err) {
      expect(err).toBeTruthy();
      events.push({type: 'request', name: 'error'});
    });

    req.on('response', function (res) {
      events.push({type: 'request', name: 'response'});

      res.on('end', function () {
        events.push({type: 'response', name: 'end'});
      });

      res.on('error', function (err) {
        expect(err).toBeTruthy();
        events.push({type: 'response', name: 'error'});
      });

      res.on('finish', function () {
        events.push({type: 'response', name: 'finish'});
      });

      res.on('data', function (data) {
        expect(data).toBeTruthy();
        events.push({type: 'response', name: 'data'});
      });
    });

    req.on('data', function (data) {
      expect(data).toBeTruthy();
      events.push({type: 'request', name: 'data'});
    });

    if (stream) {
      stream.on('end', function () {
        events.push({type: 'stream', name: 'end'});
      });

      stream.on('finish', function () {
        events.push({type: 'stream', name: 'finish'});
      });

      stream.on('data', function () {
        events.push({type: 'stream', name: 'data'});
      });

      stream.on('error', function (err) {
        expect(err).toBeTruthy();
        events.push({type: 'stream', name: 'error'});
      });
    }
  }

  function verifyEvents(expected) {
    expect(events.length).toEqual(expected.length);

    if (events.length == expected.length) {
      for (var i = 0; i < expected.length; i++) {
        expect(events[i].type).toEqual(expected[i].type);
        expect(events[i].name).toEqual(expected[i].name);
      }
    } else {
      console.log('*** Actual events', events);
    }
  }

  it('testGetRequest', function (done) {
    fs.createEntityWithDatesSync('/testfile.jpg', false, 'file content', new Date().getTime(), new Date().getTime());
    var stream = fs.createReadStream('/testfile.jpg');

    var options = {
      url: 'http://testhost/testfile.jpg',
      method: 'POST'
    };

    var req = request(options, function (err, res, body) {
      expect(err).toBeFalsy();
      expect(res.statusCode).toEqual(201);

      verifyEvents(
        [
          {type: 'stream', name: 'data'},
          {type: 'stream', name: 'end'},
          {type: 'request', name: 'response'},
          {type: 'response', name: 'end'},
          {type: 'request', name: 'end'}
        ]
      );

      var writeStream = fs.createWriteStream('/testfile1.jpg');
      options.method = 'GET';
      var req = request(options);
      captureEvents(req, writeStream);
      req.on('response', function (res) {
        expect(res.statusCode).toEqual(200);
      });
      writeStream.on('finish', function () {
        verifyEvents([
          {type: 'request', name: 'response'},
          {type: 'request', name: 'data'},
          {type: 'response', name: 'end'},
          {type: 'request', name: 'end'},
          {type: 'stream', name: 'end'},
          {type: 'stream', name: 'finish'}
        ]);

        var stat = fs.statSync('/testfile1.jpg');
        expect(stat.data).toEqual('file content');
        done();
      });
      req.pipe(writeStream);
    });
    captureEvents(req, stream);
    stream.pipe(req);
  });

  it('testCreateRequest', function (done) {
    var options = {
      url: 'http://testhost/testfile.jpg',
      method: 'POST'
    };

    var empty = new stream.PassThrough();
    empty.end(new Buffer(0));
    var req = request(options, function (err, req, body) {
      expect(err).toBeFalsy();
      expect(req.statusCode).toEqual(201);
      verifyEvents([
        {type: 'stream', name: 'end'},
        {type: 'stream', name: 'finish'},
        {type: 'request', name: 'response'},
        {type: 'response', name: 'end'},
        {type: 'request', name: 'end'}
      ]);

      options.method = 'HEAD';
      var req = request(options, function (err, res) {
        expect(err).toBeFalsy();
        expect(res.statusCode).toEqual(200);
        verifyEvents([
          {type: 'request', name: 'response'},
          {type: 'response', name: 'end'},
          {type: 'request', name: 'end'}
        ]);
        done();
      });
      captureEvents(req);
    });
    captureEvents(req, empty);
    empty.pipe(req);
  });

  it('testUpdateRequest', function (done) {
    var options = {
      url: 'http://testhost/testfile.jpg',
      method: 'POST'
    };

    var empty = stream.PassThrough();
    empty.end(new Buffer(0));
    empty.pipe(request(options, function (err, res) {
      expect(err).toBeFalsy();
      expect(res.statusCode).toEqual(201);

      options.method = 'PUT';
      fs.createEntityWithDatesSync('/testupdate.jpg', false, 'updated content', new Date().getTime(), new Date().getTime());
      var read = fs.createReadStream('/testupdate.jpg');
      var req = request(options, function (err, res) {
        expect(err).toBeFalsy();
        expect(res.statusCode).toEqual(200);
        var stat = fs.statSync('/testupdate.jpg');
        expect(stat.data).toEqual('updated content');
        verifyEvents([
          {type: 'stream', name: 'data'},
          {type: 'stream', name: 'end'},
          {type: 'request', name: 'response'},
          {type: 'response', name: 'end'},
          {type: 'request', name: 'end'}
        ]);

        options.method = 'DELETE';
        req = request(options, function (err, res) {
          expect(err).toBeFalsy();
          expect(res.statusCode).toEqual(200);
          verifyEvents([
            {type: 'request', name: 'response'},
            {type: 'response', name: 'end'},
            {type: 'request', name: 'end'}
          ]);

          options.method = 'HEAD';
          request(options, function (err, res) {
            expect(err).toBeFalsy();
            expect(res.statusCode).toEqual(404);
            done();
          });
        });
        captureEvents(req);
      });
      captureEvents(req, read);
      read.pipe(req);
    }));
  });

  it('testMoveRequest', function (done) {
    var options = {
      url: 'http://testhost/testmove.jpg',
      method:'POST'
    };

    fs.createEntitySync('/testmove.jpg', false);
    var read = fs.createReadStream('/testmove.jpg');
    var req = request(options, function (err, res) {
      expect(err).toBeFalsy();
      expect(res.statusCode).toEqual(201);

      options.method = 'MOVE';
      options['headers'] = {
        'X-Destination': '/testmoved.jpg'
      };

      request(options, function (err, res) {
        expect(err).toBeFalsy();
        expect(res.statusCode).toEqual(201);

        options.method = 'HEAD';

        request(options, function (err, res) {
          expect(err).toBeFalsy();
          expect(res.statusCode).toEqual(404);

          options.url = 'http://testhost/testmoved.jpg';

          request(options, function (err, res) {
            expect(err).toBeFalsy();
            expect(res.statusCode).toEqual(200);

            options.method = 'MOVE';
            options.headers['X-Destination'] = 'http://testhost/testmoved2.jpg';

            request(options, function (err, res) {
              expect(err).toBeFalsy();
              expect(res.statusCode).toEqual(201);

              options.url = 'http://testhost/testmoved2.jpg';
              options.method = 'HEAD';

              request(options, function (err, res) {
                expect(err).toBeFalsy();
                expect(res.statusCode).toEqual(200);
                done();
              });
            });
          });
        });
      });
    });
    read.pipe(req);
  });

  it('testRequestCallback', function (done) {
    var calledBack = false;
    requestreq.setRequestCallback(function (options, callback) {
      calledBack = true;
      expect(options.url).toEqual('http://testhost/testreqcb.jpg');
      expect(options.method).toEqual('POST');
      expect(options.data).toEqual('Hello');
      expect(options.form.test).toEqual('value');
      callback(options);
    });

    fs.createEntityWithDatesSync('/testupload.jpg', false, ' World!', new Date().getTime(), new Date().getTime());
    var read = fs.createReadStream('/testupload.jpg');

    var options = {
      url: 'http://testhost/testreqcb.jpg',
      method: 'POST'
    };

    var req = request(options, function (err, res) {
      expect(err).toBeFalsy();
      expect(res.statusCode).toEqual(201);
      expect(calledBack).toBeTruthy();
      expect(req.getWritten()).toEqual('Hello World!');
      done();
    });
    var form = req.form();
    form.append('test', 'value');
    req.write('Hello');
    read.pipe(req);
  });

  it('testRegisterUrl', function (done) {
    requestreq.registerUrl('http://testhost/testregurl.jpg', function (options, callback) {
      expect(options.url).toEqual('http://testhost/testregurl.jpg');
      expect(options.method).toEqual('GET');
      callback(null, 204, 'Hello World!');
    });

    var options = {
      url: 'http://testhost/testregurl.jpg'
    };
    var write = fs.createWriteStream('/testregurl.jpg');

    write.on('finish', function () {
      expect(write.getWritten()).toEqual('Hello World!');
      done();
    });

    var req = request(options, function (err, res) {
      expect(err).toBeFalsy();
      expect(res.statusCode).toEqual(204);
    });
    req.pipe(write);
  });

  it('testResponseError', function (done) {
    requestreq.registerUrl('http://testhost/testreserror.jpg', function (options, callback) {
      expect(options.url).toEqual('http://testhost/testreserror.jpg');
      callback('Error in response');
    });

    var options = {
      url: 'http://testhost/testreserror.jpg'
    };

    var req = request(options, function (err, res) {
      expect(err).toBeTruthy();
      expect(res).toBeFalsy();
      verifyEvents([
        {type: 'request', name: 'error'}
      ]);
      done();
    });
    captureEvents(req);
    req.end();
  });
});
