
/**
 * Module dependencies.
 */

var express = require('express')
  , app = express()
  , routes = require('./routes')
  , user = require('./routes/user')
  , http = require('http')
  , https = require('https')
  , server = http.createServer(app) 
  , path = require('path')
  , StreamingSession = require('./models/StreamingSession')
  , mongoose = require('mongoose')
  , assert = require('assert')
  , spawn = require('child_process').spawn
  , lifegraph = require("lifegraph")
  , rem = require('rem')
  , async = require('async')
  , _ = require('underscore')
  , io = require('socket.io').listen(server);

  // App key and secret (these are git ignored)
  var key = process.env.FBKEY || require('./config.json').fbapp_key;
  var secret = process.env.FBSECRET || require('./config.json').fbapp_secret;
  var namespace = 'entrance-tutorial';

/**
 * Configure application
 */
var hostUrl = 'http://entrance-tutorial.herokuapp.com';
var db;
var logoutTimeoutDict = {};
io.set('log level', 1);

// 2 hours
var logoutTimeoutExpiration = 2 * 60 * 60 * 1000

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('dburl', process.env.MONGOLAB_URI || 'mongodb://localhost:27017/' + namespace);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.cookieSession({
    secret: 'entrance-tutorial'
  }));
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

/**
 * Configure Lifegraph.
 */

lifegraph.configure(namespace, key, secret);

/**
 * Routes
 */

app.get('/', function (req, res){
  res.render('index');
});

// NON-Electric imp endpoint for Entrance taps.
app.post('/tap', function(req, res) {
  // Parse content.
  var deviceId = req.body.deviceUUID;
  var pId = req.body.pID; // assume whole body is the deviceId
  console.log("device with pid: %s and device id: %s", pId, deviceId);
  if (deviceId && pId) {
    handleTap(deviceId, pId, function (json) {
      res.json(json);
    });
  } else {
    res.send({"error": "missing deviceUUID or pID"});
  }
});

app.get('/tracks/:id', function (req, res) {
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
})

app.post('/:deviceId/listen', function (req, res) {
  if (!req.body.track) {
    return res.json({error: true, message: 'Invalid track.'}, 400);
  }

  var fb = rem.connect('facebook.com', '*').configure({
    key: key,
    secret: secret
  });
  var oauth = rem.oauth(fb);
  
  getCurrentStreamingSession(req.params.deviceId, function (err, sess) {
    if (err || !sess) {
      return res.json({error: true, message: 'No listening session.'}, 500);
    }

    sess.streamingUsers.forEach(function (tokens) {
      var user = oauth.restore(tokens.tokens);
      console.log('User:', tokens.id);
      user('me/entrance-tutorial:enter_to').post({
        song: 'http://entrance-tutorial.herokuapp.com/tracks/' + req.body.track
      }, function (err, json) {
        console.log('Posted song to Open Graph', err, json);
      })
    })

    console.log('Posting to the Open Graph');
    res.json({error: false, message: 'Posting to the Open Graph.'});
  })
});

app.get('/:deviceId/party/json', function (req, res) {
  getCurrentStreamingSession(req.params.deviceId, function (error, currentStreamingSession) {
    if (currentStreamingSession && currentStreamingSession.tracks) {
      res.json(currentStreamingSession.tracks);  
      console.log("updating with streaming users:", currentStreamingSession.streamingUsers);
      updateClientUsers(req.params.deviceId);    
    } else {
      res.json([]);
    }
  });
});

app.get("/test/:pID", function (req, res) {
  handleTap("0x6A 0xE6 0x44 0xE9", req.params.pID, function(err, user) {

  });
});

app.get('/:deviceId/party', function (req, res) {

  if (!io) {
    console.log("We have no sockets.");
    return res.send("No sockets set up in the server. Come back later.");
  }

  // Grab the device ID
  var deviceId = req.params.deviceId;

  // Create a socket in the namespace.
  var socket = io.of("/" + deviceId);

  res.render('party', {room: deviceId});
});


/**
 * Logic
 */

function handleTap (deviceId, pid, hollaback) {
  lifegraph.connect(pid, function (error, user) {
    // If we have an error, then there was a problem with the HTTP call
    // or the user isn't in the db and they need to sync
    if (error) {
      console.log("We had an error with lifegraph:", error);

      console.log(error);

      if (error == 404) {

        return hollaback({'error': "Physical ID has not been bound to an account. Go to http://connect.lifegraphlabs.com/, Connect with Entrance Tutorial, and tap again."});

      } else if (error == 406) {

        return hollaback({'error': "No tokens found. User may have revoked access."});
      }
      
    } 

    // Grab those who are already in the room 
    getCurrentStreamingSession(deviceId, function (error, currentStreamingSession) {

      indexOfStreamingUser(deviceId, user, function (err, index) {
        // If the user is in the room, delete them
        if (index != -1) {
          console.log("User already in room... deleting user from room.")
          // Update the current streaming users

          removeUserFromStreamingUsers(deviceId, user, function (err, newStreamingSession) {

            if (err) return console.log("Error the user couldn't be removed.");

            clearLogoutTimeout(user);

            updateClientUsers(deviceId);
            // If there are no more users 
            if (!newStreamingSession.streamingUsers.length) {

              console.log("No users remaining in room!");

              // Let the client know to stop playing
              updateTracksForStreamingSession(newStreamingSession, function(err, tracks) {

                sendMessageToSessionSockets(deviceId, "tracks",{});

                return hollaback({'action' : 'User Tagged Out of Room', 'message' : 'Empty session. Stopping Streaming After Song Ends.', 'cmd' : 0});
              });

              

            } else {

              updateTracksForStreamingSession(newStreamingSession, function (err, tracks) {

                sendMessageToSessionSockets(deviceId, "tracks", tracks);

                // User left room, but people are still in room
                return hollaback({'action' : 'User Tagged Out of Room', 'message' : 'Reforming track list on server for remeaning streaming users.', 'cmd' : 0});
              });              
            }
          });
        } 
        else {
          console.log("User NOT already in room! Adding user to room.");


          addUserToStreamingUsers(deviceId, user, function (err, streamingSession) {

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
  });
}

function setLogoutTimeout(deviceId, user) {

  var logoutTimeout = setTimeout(function () {

      // Remove the user from the streaming session
    removeUserFromStreamingUsers(deviceId, user, function (err, newStreamingSession) {

      // update the tracks for the current users
      updateTracksForStreamingSession(newStreamingSession, function (err, tracks) {

        // Let the client browsers know who's listening still
        updateClientUsers(deviceId);

        // Send the client browsers the new tracks
        sendMessageToSessionSockets(deviceId, "tracks", tracks);
      });
    });

  }, logoutTimeoutExpiration);

  logoutTimeoutDict[user.id] = logoutTimeout; 
}

function clearLogoutTimeout (user) {
  if (logoutTimeoutDict[user.id]) {
    clearTimeout(logoutTimeoutDict[user.id]);
    delete logoutTimeoutDict[user.id];
  }
}

function updateTracksForStreamingSession(streamingSession, hollaback) {

  zipFavoriteArtists(streamingSession.streamingUsers, function (err, artists) {
    if (err) return hollaback(err);

    getTracksFromArtists(artists, function (err, tracks) {

      // if (err) return hollaback({'error': err.message});
      if (err) return hollaback(err, null);

      shuffle(tracks);

      setTracksToStreamingSession(streamingSession, tracks, function (err, streamingSession) {

        console.log("Set", streamingSession.tracks.length, "tracks to", "room", streamingSession.deviceId + ".");

        if (err) {

          return hollaback(err, null);
        }
          return hollaback(null, tracks);
      });
    });
  });  
}



/*
 * Poll Facebook to find the favorite artists
 * of a user, then call a callback with the list of artists' names
 */
function getFacebookFavoriteArtists (facebookUser, callback) {

  // Use the Facebook API to get all the music likes of a user
  var options = {
      host: 'graph.facebook.com',
      port: 443,
      path: '/me/music?access_token=' + facebookUser.tokens.oauthAccessToken
    };
  https.get(options, function(fbres) {
      var output = '';
      fbres.on('data', function (chunk) {
          output += chunk;
      });

      fbres.on('end', function() {
        var data = JSON.parse(output).data;
        callback(null, data.map(function (artist) { return artist.name;}));
      });

      fbres.on('error', function (err) {
        callback(err, null);
      })
  });
}

function getFacebookBasicInfo(facebookUser, callback) {
  var options = {
      host: 'graph.facebook.com',
      port: 443,
      path: '/me/?access_token=' + facebookUser.tokens.oauthAccessToken
    };
  https.get(options, function(fbres) {
      var output = '';
      fbres.on('data', function (chunk) {
          output += chunk;
      });

      fbres.on('end', function() {
        var data = JSON.parse(output);

        callback(null, data);
      });

      fbres.on('error', function (err) {
        callback(err, null);
      })
  });
}

/*
 * Finds the artists that all the streaming users like
 */
 function zipFavoriteArtists(streamingUsers, callback) {

  var zippedArtists;

  // For each streaming user, find their favorite artists 
  async.map(streamingUsers, getFacebookFavoriteArtists, function(err, artists) {
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

 function sendMessageToSessionSockets(deviceId, mEvent, message) {
  if (!deviceId) return;

  io.of("/" + deviceId).emit(mEvent, message);
  
 }

 function updateClientUsers(deviceId) {
  getCurrentStreamingSession(deviceId, function (err, streamingSession) {
    async.map(streamingSession.streamingUsers, getFacebookBasicInfo, function (err, userData) {
    if (err) return console.log("Error getting basic FB info");
      sendMessageToSessionSockets(deviceId, "users", {"action" : "set", "users" : userData});
    });
  });
}

function getDistinctArray (arr, dohash) {
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

function debugObject(prefix, obj) {
  console.log(prefix + " : " + JSON.stringify(obj, 2, undefined));
}
/*
 * Gets the songs associated with each artist in the array artists.
 */
function getTracksFromArtists (artists, callback) {
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

function shuffle(list) {
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


function setCurrentStreamingSession(deviceId, streamingSession, callback) {
  streamingSession.deviceId = deviceId;
  streamingSession.save(function (err) {
    return callback(err, streamingSession);
  });
}

function getCurrentStreamingSession(deviceId, callback) {

  assert(deviceId);
  StreamingSession.findOne({
    deviceId: deviceId
  }, function (err, streamingSession) {
    if (err) {
      return callback (err, null);
    } else {
      if (!streamingSession) {
        streamingSession = new StreamingSession({ deviceId : deviceId });
        streamingSession.save(function (err) {
          if (err) return callback(err);
          else {
            return callback(null, streamingSession);
          }
        })
      }
      // Else if blah blah blah 
      else {
        return callback(null, streamingSession);
      }
    }
  })
}

function addUserToStreamingUsers(deviceId, user, callback) {
  getCurrentStreamingSession(deviceId, function (err, streamingSession) {
    streamingSession.streamingUsers.push(user);
    setCurrentStreamingSession(deviceId, streamingSession, function (err) {
      return callback(err, streamingSession);
    });
  });
}

function setTracksToStreamingSession(streamingSession, tracks, callback) {
  streamingSession.tracks = tracks;
  setCurrentStreamingSession(streamingSession.deviceId, streamingSession, function (err) {
    if (err) console.log("Error saving tracks!");
    return callback(err, streamingSession);
  });
}

function removeTrackFromStreamingSession(deviceId, track, callback) {
  getCurrentStreamingSession(deviceId, function (err, streamingSession) {
    streamingSession.tracks.splice(streamingSession.tracks.indexOf(track), 1);
    setCurrentStreamingSession(deviceId, streamingSession, function (err, revisedStreamingSession) {
      if (err) console.log("Error saving tracks! " + err);
      return callback(err, revisedStreamingSession);
    });
  });
}

function removeUserFromStreamingUsers(deviceId, userInQuestion, callback) {

  getCurrentStreamingSession(deviceId, function (err, streamingSession) {
    for (var i = 0; i < streamingSession.streamingUsers.length; i++) {
      if (streamingSession.streamingUsers[i].id == userInQuestion.id) {
        streamingSession.streamingUsers.splice(i, 1);
        break;
      }
    }

    return setCurrentStreamingSession(deviceId, streamingSession, callback);
  });
}

function indexOfStreamingUser (deviceId, userInQuestion, callback) {
  console.log("Get Current Streaming Session");
  assert(userInQuestion, "user must not be null");
  getCurrentStreamingSession(deviceId, function (err, streamingSession) {

    if (err) return callback(err, -1);

    for (var i = 0; i < streamingSession.streamingUsers.length; i++) {
      if (streamingSession.streamingUsers[i].id == userInQuestion.id) {
        return callback(null, i);
      }
    }
    return callback(null, -1);
  });
}


// Start database and get things running
console.log("connecting to database at " + app.get('dburl'));

mongoose.connect(app.get('dburl'));
db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {

  console.log("Connected to mongo.");
  // Start server.
  server.listen(app.get('port'), function(){
    console.log("Express server listening on port " + app.get('port'));
  });
})