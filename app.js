
/**
 * Module dependencies.
 */

var express = require('express')
  , app = express()
  , http = require('http')
  , server = http.createServer(app) 
  , path = require('path')
  , streamingDB = require('./controllers/streamingDB')
  , index = require('./routes/index')
  , party = require('./routes/party');

/**
 * Configure application
 */
app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('dburl', process.env.MONGOLAB_URI || 'mongodb://localhost:27017/music-party');
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

party.setSocketServer(server);
/**
 * Routes
 */
app.get('/', index.root);

app.post('/tap', party.tapHandler);

app.get('/tracks/:id', party.trackLookup);

app.post('/:deviceId/listen', party.recordListen);

app.get('/:deviceId/party/json', party.partyInfo);

app.get('/:deviceId/party', partyEntrance);


// Start database and get things running
console.log("connecting to database at " + app.get('dburl'));
streamingDB.connectToDatabase(app.get('dburl'), function(db) {
  if (db) {
    console.log("Connected to mongo.");
    // Start server.
    server.listen(app.get('port'), function(){
      console.log("Express server listening on port " + app.get('port'));
    });
  }
  else {
    console.log("We couldn't connect to the database");
  }
});