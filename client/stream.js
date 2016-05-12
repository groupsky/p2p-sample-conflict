/*
 client sends greet.
 server responds with updates since greet,
 or sends thier own greet if they are the one behind.

 greet zero: clone
 greet one: head
 greet two: revlist.

 if you recieve clone. send all revs.
 if you recieve a head, but don't have that. send revlist.
 if you reiceve a revlist, send your updates since the concestor.

 if there was an error, send the error, then end the stream.

 idea: send sparse revlist, to maximise chance that you'll hit
 bit minimise amount to send.

 after the client has greeted, send any updates since the concestor

 the patterns here is getting consistent with my other duplex streams.
 through isn't right, because it has different pause behaviour.
 */

var through = require('event-stream').through
module.exports = function (repo, peerId) {
    var queue = []
    var branch = 'master'
    var stream
    var peerId = peerId;
    var remote = []
    var remoteRef = 'remotes/'+peerId+'/'+branch;

    if (!repo.branches[remoteRef]) {
        repo.branches[remoteRef] = repo.initial;
    }

    function enqueue(op, data, opts) {
        queue.push([op, data, opts])
        stream.drain()
    }

    function remember(revs) {
        revs.forEach(function (e) {
            var id = typeof e === 'string' ? e : e.id;
            if (!remote[id]) {
                remote[id] = true;
                remote.unshift(id)
            }
        })
        console.log('REMOTE', peerId, remote)
    }

    function notifyRevs() {
        var revs = repo.revlist(branch, remote)
        if (!revs.length) return
        remember(revs)
        enqueue('have', revs, {branch: branch})
    }


    function onUpdate() {
        if (stream.paused) return;
        notifyRevs();
    }

    repo.on('update', onUpdate)

    stream = through(function (data) {
        var action = data.shift()
        var payload = data.shift()
        var opts = data.shift() || {}

        switch (action) {
            // the peer sent their refs
            case 'have':
            {
                var lastKnown = false;
                var missingRefs = payload.filter(function(ref) {
                    if (repo.commits[ref]) {
                        lastKnown = ref;
                        return false;
                    } else {
                        return true;
                    }
                });

                // if they have unseen refs
                if (missingRefs.length) {
                    // ask to get the new refs
                    enqueue('fetch', missingRefs);
                }

                remember(payload)

                if (lastKnown) {
                    repo.branches[remoteRef] = lastKnown;
                }
                break;
            }

            case 'fetch':
            {
                var refs = payload.map(repo.get);
                enqueue('push', refs);
                break;
            }

            case 'push':
            {
                remember(payload);
                repo.addCommits(payload, remoteRef);

                var remoteHead = payload[payload.length-1].id;
                if (repo.isFastForward(branch, payload)) {
                    repo.branches[branch] = remoteHead;
                    this.emit('update', payload, branch)
                } else {
                    // we got conflict
                    var head = repo.getId(branch);

                    console.warn('CONFLICT: ', peerId);
                    console.debug('LOCAL HEAD : ', head);
                    console.debug('REMOTE HEAD: ', remoteHead);
                    
                    if (remoteHead > head) {
                        repo.branches[branch] = remoteHead;
                        this.emit('update', payload, branch)
                    }
                }

                break;
            }
        }
        // if (action == 'have') {
        //
        //     var sendRevs = repo.getRevs('master', payload);
        //     remember(sendRevs)
        //     enqueue([sendRevs])
        //     //now, can start sending updates
        //     //repo.on('update',
        //     greeted = true
        // } else if (action == 'update') {
        //     remember([payload])
        //     repo.recieve(payload, branch, true)
        // }
    }, function () {
        if (!this.paused && !queue.length)
            this.emit('end')
    })

    stream.drain = function (resumed) {
        if (!stream.paused && queue.length) {
            process.nextTick(function () {
                while (!stream.paused && queue.length)
                    stream.emit('data', queue.shift())
                if (!queue.length) {
                    if (resumed)    stream.emit('drain')
                    if (stream.ended) stream.emit('end')
                }
            });
        }
        return stream
    }

    stream.resume = function () {
        stream.paused = false
        notifyRevs()
        return stream
    }

    //called from the client.
    stream.greet = function () {
        notifyRevs();
        return stream
    }
    stream.greet();

    stream.queue = queue
    stream.peerId = peerId

    return stream
}
