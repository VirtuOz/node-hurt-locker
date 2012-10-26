/*
 * Copyright 2012 VirtuOz Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * lock_manager
 *
 * @author Kevan Dunsmore
 * @created 2012/08/29
 */
var Future = require('futures').future;
var fs = require('node-fs');
var util = require('util');
var path = require('path');
var VNodeLib = require('../../vnodelib/lib/vnodelib');

// TODO: remove dependencies
var $synthesize = VNodeLib.load('synthesis').synthesize;

// TODO: remove dependencies
var eh = VNodeLib.load('error-handling');

require('jsclass');
JS.require('JS.Class');

var winston = require('winston');
var logger = winston.loggers.get('cluster-lock');

var LockManager = new JS.Class(
    {
        initialize:function ()
        {
            this.setLockDir(path.normalize('./locks'));
            this.setLockFileSuffix('.lock');
            this.setLockRetryTimeMillis(100);
            this.lockOwnerCache = {};
            this.lockFileDescriptorCache = {};
        },

        obtainLock:function (lockName, owner, timeout)
        {
            return this.__obtainLock(lockName, owner, timeout, new Date().getTime(), new Future());
        },

        __obtainLock:function (lockName, owner, timeout, firstCallTime, future)
        {
            var self = this;

            var wrap = eh.createWrapperFromFuture(future);

            var now = new Date().getTime();
            var elapsedTimeMillis = now - firstCallTime;
            if (elapsedTimeMillis > timeout)
            {
                var lockOwner = self.lockOwnerCache[lockName];

                var message = util.format("Unable to obtain lock %s for owner %j within the %dms specified " +
                                              "because it is currently owned by %j.  Total elapsed time since first " +
                                              "call is %dms.",
                                          lockName,
                                          owner,
                                          timeout,
                                          lockOwner,
                                          elapsedTimeMillis);

                logger.info("LockManager: " + message);
                future.fulfill(new Error(message), lockName, lockOwner, elapsedTimeMillis);
                return future;
            }

            logger.debug(util.format("LockManager: Obtaining lock %s with timeout %dms for owner %j.  First call " +
                                         "time was %d.  Elapsed time so far is %dms.",
                                     lockName,
                                     timeout,
                                     owner,
                                     firstCallTime,
                                     elapsedTimeMillis));
            if (self.lockOwnerCache[lockName] === owner)
            {
                // Owner already has lock.
                future.fulfill(undefined, lockName, owner, elapsedTimeMillis);
                return future;
            }

            var createLockDirResult = this.__createLockDir();
            createLockDirResult.when(wrap(doObtainLock));

            return future;

            function doObtainLock()
            {
                var lockFileName = self.__buildLockFileName(lockName);
                logger.debug("LockManager: Lock " + lockName + " will use file " + lockFileName + ".");

                fs.open(lockFileName, 'wx', function (err, fd)
                {
                    if (err)
                    {
                        logger.info(util.format("LockManager: Unable to open lock file %s with exclusive " +
                                                    "write access for lock %s and owner %j.  Will try again in " +
                                                    "approximately %dms.",
                                                lockFileName,
                                                lockFileName,
                                                owner,
                                                self.getLockRetryTimeMillis()));
                        setTimeout(self.__obtainLock.bind(self, lockName, owner, timeout, firstCallTime, future),
                                   self.getLockRetryTimeMillis());
                    }
                    else
                    {
                        // We got the lock.  We can fulfill our future!  For great justice!
                        self.lockOwnerCache[lockName] = owner;
                        self.lockFileDescriptorCache[lockName] = fd;
                        future.fulfill(undefined, lockName, owner, elapsedTimeMillis);
                    }
                });
            }
        },

        __buildLockFileName:function (lockName)
        {
            return path.join(this.getLockDir(), lockName + this.getLockFileSuffix());
        },

        releaseLock:function (lockName, owner)
        {
            var self = this;
            var future = new Future();
            var wrap = eh.createWrapperFromFuture(future);

            var actualOwner = self.lockOwnerCache[lockName];
            logger.debug(util.format("LockManager: Releasing lock %s for owner %j.",
                                     lockName,
                                     owner));
            if (actualOwner === owner)
            {
                var fd = self.lockFileDescriptorCache[lockName];

                delete self.lockOwnerCache[lockName];
                delete self.lockFileDescriptorCache[lockName];

                var lockFileName = self.__buildLockFileName(lockName);
                logger.debug(util.format("LockManager: Closing lock file %s.", lockFileName));
                fs.close(fd, wrap(function ()
                                  {
                                      logger.debug(util.format("LockManager: Deleting lock file %s.", lockFileName));
                                      fs.unlink(lockFileName, wrap(function ()
                                                                   {
                                                                       future.fulfill(undefined, lockName, owner);
                                                                   }));
                                  }));
            }
            else
            {
                var message = util.format("Owner %j cannot release lock %s", owner, lockName);

                // Owner doesn't have the lock.
                if (actualOwner)
                {
                    // There's already an owner but not the one that asked to release.
                    message += util.format(" because it is owned by %j.", actualOwner);
                }
                else
                {
                    message += " because it doesn't exist (or at least is not known to this process).  It may " +
                        "have been released by someone else.  Check the logs.";
                }

                logger.info("LockManager: " + message);
                future.fulfill(new Error(message), lockName, actualOwner);
            }

            return future;
        },


        __createLockDir:function ()
        {
            var self = this;
            var future = new Future();

            // First make sure the download directory exists.
            fs.exists(self.getLockDir(), createDirIfNecessary);

            return future;

            function createDirIfNecessary(dirExists)
            {
                if (dirExists)
                {
                    future.fulfill(undefined);
                }
                else
                {
                    logger.debug(util.format("LockManager: Lock directory %s does not exist.  Creating.",
                                             self.getLockDir()));
                    fs.mkdir(self.getLockDir(), 0777, true, future.fulfill);
                }
            }
        }
    });

$synthesize(LockManager, 'lockDir');
$synthesize(LockManager, 'lockFileSuffix');
$synthesize(LockManager, 'lockRetryTimeMillis');

module.exports = LockManager;