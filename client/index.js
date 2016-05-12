/**
 * Created by groupsky on 05.05.16.
 */

var APP_NAME = 'sample p2p conflict resolution';
var TRACKER_URL = ['wss://tracker.webtorrent.io'];

var hat = require('hat');
var sha1 = require('simple-sha1');
var zeroFill = require('zero-fill');
var Discovery = require('torrent-discovery');
var Repo = require('./snob');
var angular = require('angular');
var es = require('event-stream');

var app = angular.module('app', []);

var localRepo = new Repo();

var storeKey = "localData2";

var stored = localStorage.getItem(storeKey);
if (stored) {
    stored = JSON.parse(stored);
    for (var k in stored) {
        localRepo[k] = stored[k];
    }
}

localRepo.on('update', function (revs, branch) {
    localStorage.setItem(storeKey, JSON.stringify(localRepo));
});

/**
 * WebTorrent version.
 */
var VERSION = require('../package.json').version;

/**
 * Version number in Azureus-style. Generated from major and minor semver version.
 * For example:
 *   '0.16.1' -> '0016'
 *   '1.2.5' -> '0102'
 */
var VERSION_STR = VERSION.match(/([0-9]+)/g).slice(0, 2).map(zeroFill(2)).join('');

/**
 * Version prefix string (used in peer ID). WebTorrent uses the Azureus-style
 * encoding: '-', two characters for client id ('WW'), four ascii digits for version
 * number, '-', followed by random numbers.
 * For example:
 *   '-WW0102-'...
 */
var VERSION_PREFIX = '-GR' + VERSION_STR + '-';


app
    .run(function ($rootScope, $timeout) {

        $rootScope.data = {
            value: localRepo.checkout()
        };
        $rootScope.localRepo = localRepo;

        sha1(APP_NAME, function (infoHash) {

            var opt = {
                infoHash: infoHash,
                peerId: new Buffer(VERSION_PREFIX + hat(48)).toString('hex'),
                announce: TRACKER_URL,
            };
            var discovery = new Discovery(opt);

            $rootScope.data.peerId = opt.peerId;

            // update the MOTD
            $rootScope.send = function (value) {
                localRepo.commit({value: ('' + value).substring(0, 128)});
            };

            // ugly hack to just force angular digest
            $timeout(function refreshUI() {
                $timeout(refreshUI, 1000);
            });

            $rootScope.peers = [];
            discovery.on('peer', function (peer) {
                console.log('Peer offer', peer);
                $timeout(function () {
                    $rootScope.peers.push(peer);
                });

                (peer.repoStream = localRepo.createStream(peer.id))
                    .pipe(es.stringify())
                    .pipe(peer)
                    .pipe(es.split())
                    .pipe(es.parse())
                    .pipe(peer.repoStream);

                peer.on('disconnect', function () {
                    $timeout(function () {
                        $rootScope.peers.splice($rootScope.peers.indexOf(peer), 1);
                    });
                });
            });

            localRepo.on('update', function (revs, branch) {
                $timeout(function () {
                    $rootScope.data.revs = revs;
                    $rootScope.data.branch = branch;
                    $rootScope.data.value = localRepo.checkout();
                });
            });

        });
    });

if (process.env.NODE_ENV === 'production') {
    app.config(['$compileProvider', function ($compileProvider) {
        $compileProvider.debugInfoEnabled(false);
    }]);
}
