
var http = require('http')
  , https = require('https');
/*
 * Poll Facebook to find the favorite artists
 * of a user, then call a callback with the list of artists' names
 */
getFavoriteArtists = function (facebookUser, callback) {

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

getBasicInfo = function(facebookUser, callback) {
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

module.exports.getBasicInfo = getBasicInfo;
module.exports.getFavoriteArtists = getFavoriteArtists;
