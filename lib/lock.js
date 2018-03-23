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

var ReadWriteLock = require('rwlock');

/**
 * The Lock prototype provides locking capabilities on a given resource, identified with a key. When a lock is
 * requested, the callback provided in the method call will not be invoked until the lock is successful. Once the
 * sensitive code execution is finished, the lock can be released.
 * @param {Object} options Controls how the lock mechanism behaves.
 * @constructor
 */
function Lock(options) {
  this.lock = new ReadWriteLock();
}

/**
 * Internal method that actually performs the lock.
 * @param {SMBContext} context The context requesting the lock.
 * @param {String} key Value identifying the resource to lock.
 * @param {Function} lock The lock function to invoke.
 * @param {String} lockType Description of the type of lock. Will be used in log messages.
 * @param {Function} callback Will be invoked when the resource is locked.
 * @private
 */
function _doLock(context, key, lock, lockType, callback) {
  var logger = context.spi();
  logger.debug('requesting %s lock on %s', lockType, key);
  lock(key, function (release) {
    logger.debug('received %s lock on %s', lockType, key);
    callback(function () {
      logger.debug('releasing %s lock on %s', lockType, key);
      release();
    });
  });
}

/**
 * Requests a write lock on a resource. There may only be one write lock on a resource at a time, and there may be
 * no write lock if there are active read locks.
 * @param {SMBContext} context The context requesting the lock. Will be used for logging.
 * @param {String} key Value identifying the resource to lock.
 * @param {Function} cb Will be invoked when the resource is locked.
 * @param {Function} cb.release Should be invoked when the lock can be released.
 */
Lock.prototype.writeLock = function (context, key, cb) {
  _doLock.call(this, context, key, this.lock.writeLock, 'write', cb);
};

/**
 * Requests a read lock on a resource. There may be multiple read locks on a resources at a time, and there may be no
 * read locks if there is an active write lock.
 * @param {SMBContext} context The context requesting the lock. Will be used for logging.
 * @param {String} key Value identifying the resource to lock.
 * @param {Function} cb Will be invoked when the resource is locked.
 * @param {Function} cb.release Should be invoked when the lock can be released.
 */
Lock.prototype.readLock = function (context, key, cb) {
  _doLock.call(this, context, key, this.lock.readLock, 'read', cb);
};

module.exports = new Lock();
