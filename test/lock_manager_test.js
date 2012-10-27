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
 * lock_manager_test
 *
 * @author Kevan Dunsmore
 * @created 2012/08/29
 */
var expect = require('chai').expect;
var fs = require('fs');
var path = require('path');
var wrench = require('wrench');

var LockManager = require('../index.js').LockManager;
var config = require('../index.js').config;
var _ = require('underscore');
_.str = require('underscore.string');

describe('LockManager', function ()
{
    var rootDir = path.join(__dirname, "..");
    var tmpDir = path.join(rootDir, '/target/LockManagerTest-tmp');

    var lockManager;

    beforeEach(function (done)
               {
                   // Get rid of the temp directory before we start the test.
                   if (fs.existsSync(tmpDir))
                   {
                       wrench.rmdirSyncRecursive(tmpDir, true);
                   }
                   wrench.mkdirSyncRecursive(tmpDir);

                   // Create the module loader to be tested.
                   lockManager = new LockManager();

                   // Make sure the defaults are as expected.
                   expect(lockManager.settings.lockDir, 'default lock dir').to.equal('locks');
                   expect(lockManager.settings.lockFileSuffix, 'default lock file suffix').to.equal('.lock');
                   expect(lockManager.settings.lockRetryTimeMillis, 'default lock retry time millis').to.equal(100);

                   // Create the various directories we'll need.
                   lockManager.settings.lockDir = path.join(tmpDir, "/locks");

                   done();
               });

    describe('__createLockDir', function ()
    {
        it('should create directory', function (done)
        {
            // Make sure the dir doesn't exist before we start to avoid a false positive.
            expect(fs.existsSync(lockManager.settings.lockDir)).to.equal(false);

            var result = lockManager.__createLockDir();
            result.when(function (err)
                        {
                            expect(err).to.equal(undefined);
                            expect(fs.existsSync(lockManager.settings.lockDir)).to.equal(true);

                            createAgain();
                        });

            function createAgain()
            {
                result = lockManager.__createLockDir();
                result.when(function (err)
                            {
                                expect(err).to.equal(undefined);
                                expect(fs.existsSync(lockManager.settings.lockDir)).to.equal(true);

                                done();
                            });
            }
        });
    });


    describe('initialization', function ()
    {
        it('should initialize with default settings when no settings supplied', function (done)
        {
            var lm = new LockManager();

            expect(lm.settings).to.deep.equal(config.createDefaultConfig());
            done();
        });

        it('should initialize with settings supplied, overriding default ones and adding new ones', function (done)
        {
            var settings = {wibble: 'drumsticks', lockFileSuffix: '.customLocks'};
            var lm = new LockManager(settings);
            assertSettings(lm, settings, done);
        });


        it('should initialize with settings supplied, overriding default ones and adding new ones', function (done)
        {
            var settings = {wibble: 'drumsticks', lockFileSuffix: '.customLocks'};
            var lm = new LockManager(function()
                                     {
                                         return settings;
                                     });
            assertSettings(lm, settings, done);
        });


        function assertSettings(lm, settings, done)
        {
            // Make sure we don't have the same instance.
            expect(lm.settings === settings).to.equal(false);

            // Make sure the settings object has the default settings plus the ones we've supplied.
            var defaultSettings = config.createDefaultConfig();
            var defaultKeys = Object.keys(defaultSettings);

            // We should get wibble in here plus our overridden 'lockFileSuffix' value.
            expect(Object.keys(lm.settings).length).to.equal(defaultKeys.length + 1);
            expect(lm.settings.wibble).to.equal('drumsticks');
            expect(lm.settings.lockFileSuffix).to.equal('.customLocks');

            // Now make sure everything else is the same.
            for (var i = 0; i < defaultKeys.length; i++)
            {
                var key = defaultKeys[i];
                if (key !== 'lockFileSuffix')
                {
                    expect(lm.settings[key], key).to.equal(defaultSettings[key]);
                }
            }

            done();
        }
    });


    describe('obtain and release locks', function ()
    {
        var lockOwner = {id: 'LockOwner'};

        it('should obtain lock', function (done)
        {
            lockManager.obtainExclusiveLock('test-lock', lockOwner, 10000)
                .when(function (err, lockName, owner, elapsedTimeMillis)
                      {
                          // We shouldn't be getting an error.
                          expect(err).to.equal(undefined);

                          expect(lockName).to.equal('test-lock');
                          expect(owner).to.equal(lockOwner);
                          expect(elapsedTimeMillis).to.not.equal(undefined);

                          // And the lock file should exist.
                          expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);

                          testReleaseLockFail();
                      });

            function testReleaseLockFail()
            {
                lockManager.releaseExclusiveLock('test-lock', {id: 'Incorrect Owner'})
                    .when(function (err, lockName, owner)
                          {
                              expect(err).to.not.equal(undefined);
                              expect(lockName).to.equal('test-lock');
                              expect(owner).to.equal(lockOwner);

                              // And the lock file should exist.
                              expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);

                              testReleaseLockSucceed();
                          });
            }

            function testReleaseLockSucceed()
            {
                lockManager.releaseExclusiveLock('test-lock', lockOwner)
                    .when(function (err, lockName, owner)
                          {
                              expect(err).to.equal(undefined);
                              expect(lockName).to.equal('test-lock');
                              expect(owner).to.equal(lockOwner);

                              // Lock file should not exist.
                              expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(false);

                              done();
                          });
            }
        });

        it('should obtain the lock when requesting same lock for same owner', function (done)
        {
            lockManager.obtainExclusiveLock('test-lock', lockOwner, 10000)
                .when(function (err, lockName, owner, elapsedTimeMillis)
                      {
                          // We shouldn't be getting an error.
                          expect(err).to.equal(undefined);

                          expect(lockName).to.equal('test-lock');
                          expect(owner).to.equal(lockOwner);
                          expect(elapsedTimeMillis).to.not.equal(undefined);

                          // And the lock file should exist.
                          expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);

                          // Now try to get the lock again with the same owner.
                          lockManager.obtainExclusiveLock('test-lock', lockOwner, 10000)
                              .when(function (err, lockName, owner, elapsedTimeMillis)
                                    {
                                        // We shouldn't be getting an error.
                                        expect(err).to.equal(undefined);

                                        expect(lockName).to.equal('test-lock');
                                        expect(owner).to.equal(lockOwner);
                                        expect(elapsedTimeMillis).to.not.equal(undefined);

                                        // And the lock file should exist.
                                        expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);
                                        done();
                                    });
                      });
        });

        it('should fail to obtain the lock', function (done)
        {
            lockManager.obtainExclusiveLock('test-lock', lockOwner, 10000)
                .when(function (err, lockName, owner, elapsedTimeMillis)
                      {
                          // We shouldn't be getting an error.
                          expect(err).to.equal(undefined);

                          expect(lockName).to.equal('test-lock');
                          expect(owner).to.equal(lockOwner);
                          expect(elapsedTimeMillis).to.not.equal(undefined);

                          // And the lock file should exist.
                          expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);

                          // Now try to get the lock again with the same owner.
                          var anotherOwner = {id: 'Another Owner'};
                          lockManager.obtainExclusiveLock('test-lock', anotherOwner, 1000)
                              .when(function (err, lockName, owner, elapsedTimeMillis)
                                    {
                                        // We should be getting an error.
                                        expect(err).to.not.equal(undefined);

                                        expect(lockName).to.equal('test-lock');
                                        expect(owner).to.equal(lockOwner);
                                        expect(elapsedTimeMillis).to.be.above(1000);

                                        // And the lock file should exist.
                                        expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);
                                        done();
                                    });
                      });
        });


        it('should fail to obtain the lock when the lock file is opened by something else', function (done)
        {
            // Get a manual hold on the lock file.
            fs.mkdirSync(lockManager.settings.lockDir);
            var fd = fs.openSync(lockManager.settings.lockDir + "/test-lock.lock", 'wx');

            // Call the lock manager and ask for the lock.  This simulates the situation where another process gets
            // the lock.
            lockManager.obtainExclusiveLock('test-lock', lockOwner, 1000)
                .when(function (err, lockName, owner, elapsedTimeMillis)
                      {
                          // We should be getting an error.
                          expect(err).to.not.equal(undefined);

                          expect(lockName).to.equal('test-lock');
                          expect(owner).to.equal(undefined);
                          expect(elapsedTimeMillis).to.be.above(1000);

                          // And the lock file should exist.
                          expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(true);
                          done();
                      });
        });
    });


    describe('releaseExclusiveLock', function ()
    {
        var lockOwner = {id: 'LockOwner'};

        it('should fail when the lock does not exist', function (done)
        {
            lockManager.releaseExclusiveLock('test-lock', lockOwner)
                .when(function (err, lockName, owner)
                      {
                          // We should be getting an error.
                          expect(err).to.not.equal(undefined);

                          expect(lockName).to.equal('test-lock');
                          expect(owner).to.equal(undefined);

                          // And the lock file should not exist.
                          expect(fs.existsSync(lockManager.settings.lockDir + '/test-lock.lock')).to.equal(false);

                          done();
                      });
        });
    });
});