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

var ntstatus = require('../ntstatus');
var SMBError = require('../smberror');
var utils = require('../utils');
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var eventManager = require('../eventmanager');

/**
 * Creates an instance of Share.
 *
 * @constructor
 * @this {Share}
 * @param {String} name share name
 * @param {Object} config configuration hash
 */
var Share = function (name, config) {
  if (!(this instanceof Share)) {
    return new Share(name, config);
  }
  // call the super constructor to initialize `this`
  EventEmitter.call(this);

  this.config = config || {};
  this.name = name;
  this.description = this.config.description || '';
};

util.inherits(Share, EventEmitter);

/**
 * Retrieves the configuration of the share.
 * @returns {Object} An object containing configuration information.
 */
Share.prototype.getConfig = function () {
  return this.config;
};

/**
 * Return a flag indicating whether this is a named pipe share.
 *
 * @return {Boolean} <code>true</code> if this is a named pipe share;
 *         <code>false</code> otherwise, i.e. if it is a disk share.
 */
Share.prototype.isNamedPipe = function () {
  return false;
};

/**
 *
 * @param {Session} session
 * @param {Buffer|String} shareLevelPassword optional share-level password (may be null)
 * @param {Function} cb callback called with the connect tree
 * @param {SMBError} cb.error error (non-null if an error occurred)
 * @param {TreeConnection} cb.tree connected tree
 */
Share.prototype.connect = function (session, shareLevelPassword, cb) {
  process.nextTick(function () { cb(new SMBError(ntstatus.STATUS_NOT_IMPLEMENTED)); });
};

/**
 * Emits an event from the share.
 */
Share.prototype.emitShareEvent = function (eventName, data) {
  this.emit('shareEvent', {event: eventName, data: data});
};

/**
 * Emits an event from the share, but only if the specified timeout has elapsed since the last time it was sent.
 * @param {String} eventName Name of the event to send.
 * @param {Object} data Data to be sent with the event.
 * @param {Number} timeout Amount of time, in milliseconds.
 */
Share.prototype.emitManagedShareEvent = function (eventName, data, timeout) {
  eventManager.emitEvent(this, 'shareEvent', {event: eventName, data: data}, timeout);
};

/**
 * Emits an event from the share, but only if the specified timeout has elapsed since the last time the given event name
 * and description combination was sent.
 * @param {String} description Description to associate with the event.
 * @param {String} eventName Name of the event to send.
 * @param {Object} data Data to be sent with the event.
 * @param {Number} timeout Amount of time, in milliseconds.
 */
Share.prototype.emitManagedDescribedShareEvent = function (description, eventName, data, timeout) {
  eventManager.emitDescribedEvent(this, description, 'shareEvent', {event: eventName, data: data}, timeout);
};

/**
 * Called when the server receives an event that could be processed by the share.
 */
Share.prototype.onServerEvent = function (context, eventName, data, callback) {
  // default implementation does nothing
};

/**
 * Normalizes a unicode string in order to avoid issues related to different code points.
 * @param {String} str The value to be normalized.
 * @returns {String} A normalized string value.
 */
Share.prototype.unicodeNormalize = function (str) {
  return utils.unicodeNormalizeForm(str, this.config.unicodeNormalizeForm);
};

/**
 * Determines if two strings are equal based on their normalized unicode values.
 * @param {String} str1 The first value to be compared.
 * @param {String} str2 The second value to be compared.
 * @returns {Boolean} true if the two values are equal, otherwise false.
 */
Share.prototype.unicodeEquals = function (str1, str2) {
  return utils.unicodeEqualsForm(str1, str2, this.config.unicodeNormalizeForm);
};

module.exports = Share;

