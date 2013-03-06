var lifegraph = require("lifegraph")
  , rem = require('rem')
  , async = require('async')
  , _ = require('underscore')
  , streamingDB = require('../controllers/streamingDB')
  , facebookHelper = require('../controllers/facebookHelper');

// 2 hours
var logoutTimeoutExpiration = 2 * 60 * 60 * 1000;
var logoutTimeoutDict = {};
var io;

// App key and secret (these are git ignored)
var key = process.env.FBKEY || require('../config.json').fbapp_key;
var secret = process.env.FBSECRET || require('../config.json').fbapp_secret;
var namespace = 'musicparty';

/**
 * Configure Lifegraph.
 */

lifegraph.configure(namespace, key, secret);

setSocketServer = function(server) {
  io = require('socket.io').listen(server);
  io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10); 
    io.set('log level', 1);
  });
  console.log('io set.');
}

tapHandler = function (req, res) {
  var deviceId = req.body.deviceUUID;
  var pId = req.body.pID; // assume whole body is the deviceId
  console.log("device with pid: %s and device id: %s", pId, deviceId);
  if (deviceId && pId) {
    partyTapLogic(deviceId, pId, function (json) {
      res.json(json);
    });
  } else {
    res.send({"error": "missing deviceUUID or pID"});
  }
}

partyTapLogic = function (deviceId, pid, hollaback) {

  lifegraph.connect(pid, function (error, user) {
    // If we have an error, then there was a problem with the HTTP call
    // or the user isn't in the db and they need to sync
    if (error) {
      console.log("We had an error with lifegraph:", error);

      console.log(error);

      if (error == 404) {

        return hollaback({'error': "Physical ID has not been bound to an account. Go to http://connect.lifegraphlabs.com/, Connect with Music Player App, and tap again."});

      } else if (error == 406) {

        return hollaback({'error': "No tokens found. User may have revoked access."});
      }
      
    } 

    partyJoinLogic(deviceId, user, hollaback);
  });
}

joinHandler = function (req, res) {
  var deviceId = req.body.deviceUUID;
  if (deviceId && req.session.profile) {
    var user = oauth.session(req);
    user.saveState(function (tokens) {
      console.log(tokens);
      partyJoinLogic(deviceId, {
        id: req.session.profile.id,
        tokens: tokens
      }, function (json) {
        res.redirect('/' + deviceId + '/party/');
      });
    });
  } else {
    res.send({"error": "missing deviceUUID or not logged in"});
  }
}

function partyJoinLogic (deviceId, user, hollaback) {

  // Grab those who are already in the room 
  streamingDB.getCurrentStreamingSession(deviceId, function (error, currentStreamingSession) {

    streamingDB.indexOfStreamingUser(deviceId, user, function (err, index) {
      // If the user is in the room, delete them
      if (index != -1) {
        console.log("User already in room... deleting user from room.")
        // Update the current streaming users

        streamingDB.removeUserFromStreamingUsers(deviceId, user, function (err, newStreamingSession) {

          if (err) return console.log("Error the user couldn't be removed.");

          clearLogoutTimeout(user);

          updateClientUsers(deviceId);
          // If there are no more users 
          if (!newStreamingSession.streamingUsers.length) {
            console.log("No users remaining in room!");

            // Let the client know to stop playing
            updateTracksForStreamingSession(newStreamingSession, function (err, tracks) {
              sendMessageToSessionSockets(deviceId, "tracks",{});
              hollaback({'action' : 'User Tagged Out of Room', 'message' : 'Empty session. Stopping Streaming After Song Ends.', 'cmd' : 0});
            });
          } else {
            updateTracksForStreamingSession(newStreamingSession, function (err, tracks) {
              sendMessageToSessionSockets(deviceId, "tracks", tracks);

              // User left room, but people are still in room
              hollaback({'action' : 'User Tagged Out of Room', 'message' : 'Reforming track list on server for remeaning streaming users.', 'cmd' : 0});
            });              
          }
        });
      } 
      else {
        console.log("User NOT already in room! Adding user to room.");


        streamingDB.addUserToStreamingUsers(deviceId, user, function (err, streamingSession) {

          if (err) return console.log("User could not be added to room.");

          setLogoutTimeout(deviceId, user);

          updateClientUsers(deviceId);

          updateTracksForStreamingSession(streamingSession, function (err, tracks) {

            if (err) {
              console.log("Error updating tracks: " + err.message);

              return hollaback({'error': err.message});
            }
            else {
              if (tracks.length) {

                sendMessageToSessionSockets(deviceId, "tracks", tracks);

                return hollaback({'action': 'User Added To Streaming Session', 'message': 'Opening Browser if not already open', 'cmd' : '1'});
              }
              else {
                return hollaback({'error': 'User Added To Streaming Session but they have  no tracks!'});
              }
            }
          })
        });
      }
    });
  });
}


updateTracksForStreamingSession = function (streamingSession, hollaback) {

  zipFavoriteArtists(streamingSession.streamingUsers, function (err, artists) {
    if (err) return hollaback(err);

    getTracksFromArtists(artists, function (err, tracks) {

      // if (err) return hollaback({'error': err.message});
      if (err) return hollaback(err, null);

      shuffle(tracks);

      streamingDB.setTracksToStreamingSession(streamingSession, tracks, function (err, streamingSession) {

        console.log("Set", streamingSession.tracks.length, "tracks to", "room", streamingSession.deviceId + ".");

        if (err) {

          return hollaback(err, null);
        }
          return hollaback(null, tracks);
      });
    });
  });  
}


partyEntrance = function (req, res) {
  if (!io) {
    console.log("We have no sockets.");
    return res.send("No sockets set up in the server. Come back later.");
  }

  // Grab the device ID
  var deviceId = req.params.deviceId;

  // Create a socket in the namespace.
  var socket = io.of("/" + deviceId);


  streamingDB.getCurrentStreamingSession(req.params.deviceId, function (error, currentStreamingSession) {
    console.log('here', currentStreamingSession.streamingUsers[0], req.session.profile);
    var inroom = req.session.profile && currentStreamingSession.streamingUsers.some(function (u) {
      return String(u.id) == String(req.session.profile.id)
    });

    res.render('party', {
      profile: req.session.profile,
      inroom: inroom,
      room: deviceId
    });
  });
}


partyInfo = function (req, res) {
  streamingDB.getCurrentStreamingSession(req.params.deviceId, function (error, currentStreamingSession) {
    if (currentStreamingSession && currentStreamingSession.tracks) {
      res.json(currentStreamingSession.tracks);  
      console.log("updating with streaming users:", currentStreamingSession.streamingUsers);
      updateClientUsers(req.params.deviceId);    
    } else {
      res.json([]);
    }
  });
}


recordListenOnFacebook = function(req, res) {
  if (!req.body.track) {
    return res.json({error: true, message: 'Invalid track.'}, 400);
  }

  var fb = rem.connect('facebook.com', '*').configure({
    key: key,
    secret: secret
  });
  var oauth = rem.oauth(fb);
  
  streamingDB.getCurrentStreamingSession(req.params.deviceId, function (err, sess) {
    if (err || !sess) {
      return res.json({error: true, message: 'No listening session.'}, 500);
    }

    sess.streamingUsers.forEach(function (tokens) {
      var user = oauth.restore(tokens.tokens);
      console.log('User:', tokens.id);
      user('me/music.listens').post({
        song: 'http://musicparty.herokuapp.com/tracks/' + req.body.track
      }, function (err, json) {
        console.log('Posted song to Open Graph', err, json);
      })
    })

    console.log('Posting to the Open Graph');
    res.json({error: false, message: 'Posting to the Open Graph.'});
  })
}


trackLookup = function (req, res) {
  rem.json('http://ws.spotify.com/lookup/1/.json', {
    uri: req.params.id
  }).get(function (err, json) {
    if (!json) {
      return res.send('No such song.', 404);
    }

    res.write('<head prefix="og: http://ogp.me/ns# fb: http://ogp.me/ns/fb# music: http://ogp.me/ns/music#">');
    res.write('<meta property="fb:app_id"       content="' + key + '" />');
    res.write('<meta property="og:type"         content="music.song" />');
    res.write('<meta property="og:title"        content="' + (json.track && json.track.name) + ' &mdash; ' + ((json.track.artists || [])[0] || {}).name + '" />');
    res.write('<meta property="og:image"        content="https://s-static.ak.fbcdn.net/images/devsite/attachment_blank.png" /> ');
    res.end('Done.');
  });
}

setLogoutTimeout = function(deviceId, user) {

  var logoutTimeout = setTimeout(function () {

      // Remove the user from the streaming session
    streamingDB.removeUserFromStreamingUsers(deviceId, user, function (err, newStreamingSession) {

      // update the tracks for the current users
      streamingDB.updateTracksForStreamingSession(newStreamingSession, function (err, tracks) {

        // Let the client browsers know who's listening still
        updateClientUsers(deviceId);

        // Send the client browsers the new tracks
        sendMessageToSessionSockets(deviceId, "tracks", tracks);
      });
    });

  }, logoutTimeoutExpiration);

  logoutTimeoutDict[user.id] = logoutTimeout; 
}

clearLogoutTimeout = function (user) {
  if (logoutTimeoutDict[user.id]) {
    clearTimeout(logoutTimeoutDict[user.id]);
    delete logoutTimeoutDict[user.id];
  }
}

/*
 * Gets the songs associated with each artist in the array artists.
 */
getTracksFromArtists = function (artists, callback) {
  if (!artists.length) {
    console.log("There are no artists.");
    return callback(null, []);
  }
  // Search tracks by each artist.
  shuffle(artists);

  // console.log("artists: ", artists);

  // For each artist in this list, do this function then get back together when it's done
  async.map(artists.splice(0, 20), function (artist, next) {
    // Ask spotify for tracks
    rem.json('http://ws.spotify.com/search/1/track.json').get({
      q: artist
    }, function (err, json) {

      // If there is an error, return empty brackets?
      if (err) {

        console.log("Issue requesting tracks from Spotify for artist:",  artist);

        return next(err, []);
      }

      if (!json || !json.tracks || !json.tracks.length) {
        return next(null, []);
      }

      console.log(artist);

      return next(null, json.tracks.filter(function (track) {
        return parseFloat(track.popularity) > 0.4;
      }).map(function (track) {
        return {
          artist: artist,
          track: track.name,
          url: track.href,
          popularity: parseFloat(track.popularity)
        };
      }));
    });
  }, function (err, tracks) {
    if (!err && tracks.length) {
      tracks = Array.prototype.concat.apply([], tracks);
      shuffle(tracks);
      tracks.sort(function (a, b) {
        var popa = ((a.popularity*10)|0), popb = ((b.popularity*10)|0);
        return popa > popb ? -1 : popa < popb ? 1 : 0;
      });
      tracks = getDistinctArray(tracks, function (el) {
        return String(el.artist) + ' ::: ' + String(el.track);
      });
    }
    callback(err, tracks);
  });
}

// Shuffles list in-place

shuffle = function(list) {
  var i, j, t;
  for (i = 1; i < list.length; i++) {
    j = Math.floor(Math.random()*(1+i));  // choose j in [0..i]
    if (j != i) {
      t = list[i];                        // swap list[i] and list[j]
      list[i] = list[j];
      list[j] = t;
    }
  }
}

sendMessageToSessionSockets = function (deviceId, mEvent, message) {
  if (!deviceId || !io) {

    console.log("Error: trying to send socket message before configure");
    return;
  }

  io.of("/" + deviceId).emit(mEvent, message);
  
 }

updateClientUsers = function(deviceId) {
  streamingDB.getCurrentStreamingSession(deviceId, function (err, streamingSession) {
    async.map(streamingSession.streamingUsers, facebookHelper.getBasicInfo, function (err, userData) {
    if (err) return console.log("Error getting basic FB info");
      sendMessageToSessionSockets(deviceId, "users", {"action" : "set", "users" : userData});
    });
  });
}

getDistinctArray = function (arr, dohash) {
  var dups = {};
  return arr.filter(function(el) {
    var hash = dohash(el);
    var isDup = dups[hash];
    dups[hash] = true;
    return !isDup;
  });
}

Array.prototype.clean = function(deleteValue) {
  for (var i = 0; i < this.length; i++) {
    if (this[i] == deleteValue) {       
      this.splice(i, 1);
      i--;
    }
  }
  return this;
};


/*
 * Finds the artists that all the streaming users like
 */
zipFavoriteArtists = function(streamingUsers, callback) {

  var zippedArtists;

  // For each streaming user, find their favorite artists 
  async.map(streamingUsers, facebookHelper.getFavoriteArtists, function(err, artists) {
    if (err) {
      console.log("Error retrieving artist intersection: " + err);
    }
    else {

      artists.length ? zippedArtists = _.flatten(_.zip.apply(_, artists)) : zippedArtists = [];

      zippedArtists.clean(undefined);
    }

    callback(err, zippedArtists);
  });
 }


module.exports.setSocketServer = setSocketServer;
module.exports.tapHandler = tapHandler;
module.exports.joinHandler = joinHandler;
module.exports.partyEntrance = partyEntrance;
module.exports.partyInfo = partyInfo
module.exports.trackLookup = trackLookup;
module.exports.recordListen = recordListenOnFacebook;