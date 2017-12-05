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

function processConfig(config, cb) {
  var self = this;
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

  if (cb) {
    cb(null, config);
  }
}

function parseFileContents(contents) {
  var home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    home = home.toString().replace(/\\/g, '/');
  }
  contents = contents.toString().replace(/\$\{home\}/g, home);
  return JSON.parse(contents);
}

Logging.prototype.initSync = function (configFile) {
  var config;
  if (_.isObject(configFile)) {
    config = configFile;
  } else {
    if (!configFile) {
      configFile = path.join(__dirname, CONFIG_FILE);
    }

    if (!fs.existsSync(configFile)) {
      configFile = path.join(process.cwd(), configFile);
    }

    config = parseFileContents(fs.readFileSync(configFile));
  }
  processConfig.call(this, config);
  return config;
};

Logging.prototype.init = function (configFile, done) {
  var self = this;
  if (_.isObject(configFile)) {
    processConfig.call(self, configFile, done);
  } else {
    if (!configFile) {
      configFile = path.join(__dirname, CONFIG_FILE);
    }

    var configPath = configFile;
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
            config = parseFileContents(contents);
          } catch (e) {
            done(e);
            return;
          }
          processConfig.call(self, config, done);
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
