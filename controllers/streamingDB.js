var mongojs = require('mongojs');

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

exports.removeUserFromStreamingUser = function (deviceId, userInQuestion, callback) {

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

exports.indexOfStreamingUser = function (deviceId, userInQuestion, callback) {
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
