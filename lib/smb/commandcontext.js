/*
 *  Copyright 2017 Adobe Systems Incorporated. All rights reserved.
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

var SMBContext = require('../smbcontext');

var SMB = require('./constants');

function CommandContext(context) {
  if (!context) {
    context = new SMBContext().withLabel('CommandContext.constructor');
  }
  this.context = context;
}

CommandContext.prototype.withMoveInfo = function (connection, oldName, newName, tid) {
  this.context.withDetail('cid', connection.getConnectionId()).withDetail('oldFileName', oldName).withDetail('newFileName', newName).withDetail('tid', tid);
  return this;
};

CommandContext.prototype.withDirectoryInfo = function (connection, directoryName, tid) {
  this.context.withDetail('cid', connection.getConnectionId()).withDetail('directoryName', directoryName).withDetail('tid', tid);
  return this;
};

CommandContext.prototype.withFileInfo = function (connection, fileName, tid, fid) {
  this.context.withDetail('cid', connection.getConnectionId()).withDetail('fileName', fileName).withDetail('tid', tid);
  if (fid !== undefined) {
    this.context.withDetail('fid', fid);
  }
  return this;
};

CommandContext.prototype.withVolumeInfo = function (connection, volumeLabel, tid) {
  this.context.withDetail('cid', connection.getConnectionId()).withDetail('volumeLabel', volumeLabel).withDetail('tid', tid);
  return this;
};

CommandContext.prototype.wrapHandlerCallback = function (msg, commandId, cb) {
  var params = this.context.getDetails();
  var commandName;
  if (msg.header.commandId == commandId) {
    // simple command
    commandName = SMB.COMMAND_TO_STRING[commandId];
  } else {
    // command with subcommand
    switch (SMB.COMMAND_TO_STRING[msg.header.commandId]) {
      case 'transaction':
        commandName = SMB.TRANS_SUBCOMMAND_TO_STRING[commandId];
        break;
      case 'transaction2':
        commandName = SMB.TRANS2_SUBCOMMAND_TO_STRING[commandId];
        break;
      case 'nt_transact':
        commandName = SMB.NTTRANS_SUBCOMMAND_TO_STRING[commandId];
        break;
      default:
        commandName = 'UNKNOWN';
    }
  }
  params['commandName'] = commandName;
  return this.context.wrapContextCallback(params, cb);
};

module.exports = CommandContext;
