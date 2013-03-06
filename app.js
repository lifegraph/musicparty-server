
/**
 * Module dependencies.
 */

var express = require('express')
  , app = express()
  , http = require('http')
  , server = http.createServer(app) 
  , path = require('path')
  , rem = require('rem');

var streamingDB = require('./controllers/streamingDB')
  , index = require('./routes/index')
  , party = require('./routes/party');

/**
 * Configure application
 */
app.configure(function () {
  app.set('port', process.env.PORT || 3000);
  app.set('dburl', process.env.MONGOLAB_URI || 'mongodb://localhost:27017/music-party');
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.cookieParser(process.env.SESSION_SECRET || 'this is a badly kept secret'));
  app.use(express.session());
  app.use(express.bodyParser());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function () {
  app.set('host', 'localhost:3000');
  app.use(express.errorHandler());
});

app.configure('production', function () {
  app.set('host', 'musicparty.herokuapp.com');
});

party.setSocketServer(server);

/**
 * Facebook login.
 */

var key = process.env.FBKEY || require('./config.json').fbapp_key;
var secret = process.env.FBSECRET || require('./config.json').fbapp_secret;
var namespace = 'musicparty';

var fb = rem.connect('facebook.com', '*').configure({
  key: key,
  secret: secret
});

// OAuth lib.
var oauth = rem.oauth(fb, 'http://' + app.get('host') + '/oauth/callback');
global.oauth = oauth;

// oauth.middleware intercepts the callback url that we set when we
// created the oauth middleware.
app.use(oauth.middleware(function (req, res, next) {
  console.log("User is now authenticated.");
  var user = oauth.session(req);
  if (user) {
    user('me').get(function (err, json) {
      if (!err && json) {
        req.session.profile = json;
      }
      res.redirect('/');
    });
  } else {
    res.redirect('/');
  }
}));

// oauth.login() is a route to redirect to the OAuth login endpoint.
// Use oauth.login({ scope: ... }) to set your oauth scope(s).
app.get('/login/', oauth.login({
  scope: ['publish_stream', 'user_actions.music', 'user_likes']
}));

// Logout URL clears the user's session.
app.get('/logout/', oauth.logout(function (req, res) {
  delete req.session.profile;
  res.redirect('/');
}));

/**
 * Routes
 */

// Pages
app.get('/', index.root);
app.get('/:deviceId/party', party.partyEntrance);

// API
app.post('/tap', party.tapHandler);
app.post('/join', party.joinHandler);
app.get('/tracks/:id', party.trackLookup);
app.get('/:deviceId/party/json', party.partyInfo);
app.post('/:deviceId/listen', party.recordListen);

/**
 * Launch
 */

// Start database and get things running
console.log("connecting to database at " + app.get('dburl'));
streamingDB.connectToDatabase(app.get('dburl'), function(db) {
  if (db) {
    console.log("Connected to mongo.");
    // Start server.
    server.listen(app.get('port'), function(){
      console.log("Express server listening on port " + app.get('port'));
    });
  } else {
    console.log("We couldn't connect to the database");
  }
});