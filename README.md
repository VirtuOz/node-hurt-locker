hurt-locker
===========

General
-------

Having a pessimistic lock mechanism isn't a pessimistic thing.  It's awesome.  You can keep other threads out of your
business with a nice critical section.  You just have to be careful to unlock before you return.  And be careful about
deadlocks.  And giant mice.   With great big pointy teeth.

OK, maybe not so much those but it's nice to have a critical section capability.  I hear you saying "but Node is single
threaded!  I don't need no steengkeeng creeteecal sections!"  Well, you do if you need to keep other processes at bay.
This library allows you to do that but only on a single machine.  It's compatible with _app-cluster_ and any other
Node processes running on the same box.  Think of it as a _synchronized_ block in Java or a _lock_ block in C#.

Here's how you can use it to obtain and release a lock:

    var LockManager = require('cluster-lock').LockManager;
    .
    .
    .
    var lockManager = new LockManager();

    // Ask for a lock called 'my-lock'.  Supply an owner object and a timeout of one second.  If we don't get the lock
    // in the timeout period, we'll get an error.
    var lockResult = lockManager.obtainLock('my-lock', {name: 'bob'}, 1000);

    // Now wait for the lock.
    lockResult.when(function(err, lockName, owner, elapsedTimeMillis)
    {
        // err -> undefined if everything went well, otherwise and Error object that contains a description of the problem.
        // lockName -> The name of the lock.
        // owner ->  The supplied owner object if you got the lock.  The actual owner if you didn't.
        // elapsedTimeMillis -> The amount of time since you originally requested the lock.  Approximate.
        if (err)
        {
            // We didn't get the lock!  We must do our best to handle our disappointment!
            return;
        }

        // Do something in the critical section, like drink tea or eat cucumber sandwiches or something.

        // Unlock.
        var releaseResult = lockManager.releaseLock(lockName, owner);
        releaseResult.when(function(err, lockName, owner)
        {
            // err -> undefined if the release worked.  An error if not.
            // lockName -> The name of the lock that was released (or failed to release).
            // owner -> If the release worked, will be the same as the owner you passed to the release method.
            //          If the release failed, will be the actual owner or undefined if there is no actual owner.
            if (err)
            {
                // Something went wrong when releasing the lock!
            }
        });
    });

The lock semantics are pretty straight forward: You either get the lock in the supplied timeout period or you don't.
The 'owner' object is an arbitrary object.  It can have any format, be anything at all (well, anything that can be
translated to JSON using JSON.stringify, which means that you can't have cyclic properties).  Best to pick something
that looks good in the logs.  The timeout period is in milliseconds and is, like all Javascript timings, approximate.

The release semantics are not so simple because the release call will fail if you try to release a lock with the wrong
owner object.  That's why the 'owner' parameter can change based on the error and may even be undefined if a low-level
problem occurs.


Under The Covers
----------------

The lock manager uses files to obtain locks.  Each lock corresponds to a file descriptor open for read-exclusive
access.  When something gets a lock and something else asks for it, the lock manager internally kicks off a _setTimeout_
call to re-check for the lock.  After enough of these have gone by with no success, the LockManager fulfills the _Future_
result with an error.  Lock requests are not served in sequential order.  If you wait long enough, and the previous holders
are sensible and release the lock you're waiting for, you'll get it.  Eventually.


Configuration
-------------

The lock manager exposes some setters and getters to allow configuration.  Here's the rundown:

    var LockManager = require('cluster-lock').LockManager;
    .
    .
    .
    var lockManager = new LockManager();

    // Lock directory.  Default is ./locks
    lockManager.setLockDir(<your lock directory>); // Sets the location on the filesystem of the lock file directory.
    var lockDir = lockManager.getLockDir();        // Gives the location of the lock directory.

    // Lock file suffix.  Default is .lock
    lockmanager.setLockFileSuffix(<your suffix>);  // Sets the lock file suffix.  You can use this to delineate the
                                                   // locks written by different lock managers in the same lock directory.
    var lockFileSuffix = lockManager.getLockFileSuffix();  // Gives the current lock file suffix.


    // Lock retry time.  Default is 100ms.
    lockManager.setLockRetryTimeMillis(<your retry time>);   // The amount of time to wait between successive lock retry
                                                             // attempts.
    var retryTime = lockManager.getLockRetryTimeMillis();    // Gives the current lock retry time.
    this.setLockDir(path.normalize('./locks'));

LockManager will create the directory it needs lazily.  You should make sure your Node process has rights to be able to
read and write to and from the place where the lock directory will live.


Known Issues
============

o There seems to be a problem obtaining a lock when the lock directory path contains spaces.  Looks like it may be a
  node.js or OSX issue.
