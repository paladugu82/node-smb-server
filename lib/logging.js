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

var fs = require('fs');
var path = require('path');

var winston = require('winston');
var _ = require('lodash');

var CONFIG_FILE = 'logging.json';

// Read a config.json file from the file system, parse it and pass it to the next function in the
// chain.

function Logging() {
  if (!(this instanceof Logging)) {
    return new Logging();
  }

  this.loggerMap = {};
}

Logging.prototype.init = function (configFile, done) {
  var self = this;

  function getTransports(config) {
    var transports = [];
    if (config.file) {
      transports.push(new winston.transports.File(config.file));
    }
    if (config.console) {
      transports.push(new winston.transports.Console(config.console));
    }
    return transports;
  }

  function processConfig(config) {
    // configure loggers
    Object.keys(config).forEach(function (key) {
      if (config[key].config) {
        self.loggerMap[key] = config[key].config;
      } else {
        var transports = getTransports(config[key]);

        var loggerConfig = {};
        if (transports.length) {
          loggerConfig['transports'] = transports;
        }
        winston.loggers.add(key, loggerConfig);
      }
    });
    var logger = winston.loggers.get('default');
    logger.info('logging initialized.');

    done(null);
  }

  if (_.isObject(configFile)) {
    processConfig(configFile);
  } else {
    if (!configFile) {
      configFile = CONFIG_FILE;
    }

    var configPath = path.join(__dirname, configFile);
    fs.exists(configPath, function (err, exists) {
      if (err) {
        done(err);
      } else if (!exists) {
        configPath = path.join(process.cwd(), configFile);
      }

      fs.readFile(configPath, function (err, contents) {
        if (err) {
          done(err);
        } else {
          var config;
          try {
            config = JSON.parse(contents);
          } catch (e) {
            done(e);
            return;
          }
          processConfig(config);
        }
      });
    });
  }
};

Logging.prototype.getLogger = function (name) {
  if (this.loggerMap[name]) {
    return winston.loggers.get(this.loggerMap[name]);
  } else {
    return winston.loggers.get(name);
  }
};

module.exports = new Logging();
