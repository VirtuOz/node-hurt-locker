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
var fs = require('fs-extra');
var util = require('util');
var path = require('path');
var exec = require('child_process').exec;
var eh = require('error-handling');

var config = require('./lm_config');

var Class = require('jsclass/src/core').Class;

var logger;

//TODO use ES6 classes
var LockManager = new Class(
    {
        initialize: function (settings, applogger)
        {
            if (applogger) {
                logger = applogger;
            }
            else {
                logger = require('winston').loggers.get('node-hurt-locker');
            }

            if (settings instanceof Function)
            {
                settings = settings();
            }

            this.settings = config.createDefaultConfig();
            if (settings)
            {
                Object.assign(this.settings, settings);
            }

            this.lockOwnerCache = {};
            this.lockFileDescriptorCache = {};
        },

        obtainExclusiveLock: function (lockName, owner, timeout)
        {
            return this.__obtainExclusiveLock(lockName, owner, timeout, new Date().getTime(), new Future());
        },

        __obtainExclusiveLock: function (lockName, owner, timeout, firstCallTime, future)
        {
            var self = this;

            var wrap = eh.createWrapperFromFuture(future);

            var now = new Date().getTime();
            var elapsedTimeMillis = now - firstCallTime;
            if (elapsedTimeMillis > timeout)
            {
                /* Check if the process owning the lock still exists, to spot dead locks. */
                fs.readFile(self.__buildLockFileName(lockName), function(err, data) {
                    if (err) {
                        logger.error("LockManager: " + err);
                    }
                    else {
                        /* man pgrep: pgrep looks through the currently running processes and lists
                                      the process IDs which matches the selection criteria to stdout:
                            $ pgrep node
                            2535
                            2537
                            2538
                        */
                        exec('pgrep node', function(error, stdout, stderr) {
                            if (error) {
                                logger.error("LockManager: " + error);
                            }
                            var pids = stdout.split('\n');
                            if (pids.indexOf('' + data) === -1) { /* casting to string because data is apparently an Object */
                                logger.error("SEVERE: PROCESS WITH PID=" + data + ", OWNER OF LOCK " + lockName +
                                    ", DOES NOT EXIST. DELETING THE LOCK.");
                                fs.unlink(self.__buildLockFileName(lockName), function(err) {
                                    if (err) {
                                        logger.error('Error while deleting lock ' + lockName + ': ' + err);
                                    }
                                });
                            }
                        });
                    }
                });

                var lockOwner = self.lockOwnerCache[lockName];

                var message = util.format("Unable to obtain exclusive lock %s for owner %j within the %dms specified " +
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

            logger.debug(util.format("LockManager: Obtaining exclusive lock %s with timeout %dms for owner %j.  First call " +
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
                                                self.settings.lockRetryTimeMillis));
                        setTimeout(self.__obtainExclusiveLock.bind(self, lockName, owner, timeout, firstCallTime, future),
                                   self.settings.lockRetryTimeMillis);
                    }
                    else
                    {
                        // We got the lock.  We can fulfill our future!  For great justice!
                        self.lockOwnerCache[lockName] = owner;
                        self.lockFileDescriptorCache[lockName] = fd;
                        /* store pid of the process that took the lock in the lock file */
                        fs.write(fd, JSON.stringify(process.pid), undefined, undefined, function() {
                            future.fulfill(undefined, lockName, owner, elapsedTimeMillis);
                        });
                    }
                });
            }
        },

        __buildLockFileName: function (lockName)
        {
            return path.join(this.settings.lockDir, lockName + this.settings.lockFileSuffix);
        },

        releaseExclusiveLock: function (lockName, owner)
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


        /**
         * Alias for releaseExclusiveLock.
         */
        releaseLock: this.releaseExclusiveLock,


        __createLockDir: function ()
        {
            var self = this;
            var future = new Future();

            // First make sure the download directory exists.
            fs.exists(self.settings.lockDir, createDirIfNecessary);

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
                                             self.settings.lockDir));
                    fs.mkdirs(self.settings.lockDir, 0o777, future.fulfill);
                }
            }
        }
    });

module.exports = LockManager;
