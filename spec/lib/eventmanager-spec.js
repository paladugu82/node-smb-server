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

var EventEmitter = require('events').EventEmitter;
var manager = require('../../lib/eventmanager');

describe('EventManager', function () {
  var emitter;

  beforeEach(function () {
    emitter = new EventEmitter();
    spyOn(emitter, 'emit');
  });

  it('testEmitEvent', function (done) {
    manager.emitEvent(emitter, 'testevent', 'test', 50);
    expect(emitter.emit).toHaveBeenCalledWith('testevent', 'test');
    expect(emitter.emit.calls.length).toEqual(1);
    manager.emitEvent(emitter, 'testevent', 'test', 50);
    expect(emitter.emit.calls.length).toEqual(1);
    setTimeout(function () {
      manager.emitEvent(emitter, 'testevent', 'test', 50);
      expect(emitter.emit.calls.length).toEqual(2);
      done();
    }, 100);
  });

  it('testEmitDescribedEvent', function (done) {
    manager.emitDescribedEvent(emitter, 'describer1', 'testevent', 'describer1', 50);
    expect(emitter.emit).toHaveBeenCalledWith('testevent', 'describer1');
    expect(emitter.emit.calls.length).toEqual(1);
    manager.emitDescribedEvent(emitter, 'describer2', 'testevent', 'describer2', 50);
    expect(emitter.emit).toHaveBeenCalledWith('testevent', 'describer2');
    expect(emitter.emit.calls.length).toEqual(2);
    manager.emitDescribedEvent(emitter, 'describer1', 'testevent', 'describer1', 50);
    manager.emitDescribedEvent(emitter, 'describer2', 'testevent', 'describer2', 50);
    expect(emitter.emit.calls.length).toEqual(2);
    setTimeout(function () {
      manager.emitDescribedEvent(emitter, 'describer1', 'testevent', 'describer1', 50);
      manager.emitDescribedEvent(emitter, 'describer2', 'testevent', 'describer2', 50);
      expect(emitter.emit.calls.length).toEqual(4);
      done();
    }, 100);
  });
});
