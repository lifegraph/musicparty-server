var browser_socket = io.connect(extractDeviceIdFromURL());
var currentTrack;
var nextTrackTimeout;

browser_socket.on('connect', function (data) {
  console.log("We've got a connection, captain!: " + extractDeviceIdFromURL());
});

browser_socket.on('tracks', function (data) {
  clearTimeout(nextTrackTimeout);
  setUpPlaylist(data);
});

browser_socket.on('users', function (data) {
  if (data.action == "set") {
    setUserTable(data.users);
  }
});

function extractDeviceIdFromURL() {
  // Grab the different parts of the url
  var comps = window.location.href.split("/");

  // Return the number before party
  return "/" + comps[comps.indexOf('party')-1];
  
}

function playSong (artist, title, uri, next) {
  var state = {
    playable: false
  };

  // http://toma.hk/api.html
  currentTrack = tomahkAPI.Track(title, artist, {
    width: 300,
    height: 300,
    disabledResolvers: ['SpotifyMetadata'],
    handlers: {
      onloaded: function() {
        console.log(currentTrack.connection+":\n  api loaded");
      },
      onended: function() {
        next();
        console.log(currentTrack.connection+":\n  Song ended: "+currentTrack.artist+" - "+currentTrack.title);
      },
      onplayable: function() {
        state.playable = true;
        currentTrack.play();
        $.post(extractDeviceIdFromURL() + '/listen', {
          track: uri,
        });
        console.log(currentTrack.connection+":\n  playable");
      },
      onresolved: function(resolver, result) {
        console.log(currentTrack.connection+":\n  currentTrack found: "+resolver+" - "+ result.track + " by "+result.artist);
      },
      ontimeupdate: function(timeupdate) {
      }
    }
  });

  $('#musictarget').html('').append(currentTrack.render());

  nextTrackTimeout = setTimeout(function () {
    if (!state.playable) {
      console.log('Track timed out, skipping.');
      next();
    }
  }, 4000);

  return state;
}

$(function () {
  $.get(extractDeviceIdFromURL() + '/party/json', function (tracks) {
    setUpPlaylist(tracks);
  });
});

function setUpPlaylist(tracks) {

  if (!tracks || !tracks.length) {

    if (currentTrack) {
      currentTrack.pause();
      currentTrack = null;
      showHelpfulInfo(false);
    } 

    $('#musictarget').html('');
  }
  var state = null;

  function nextTrack () {
    if (state) {
      state.playable = true;
    }

    if (!tracks.length) {
      return;
    }

    var track = tracks.shift();

    if (track) {
      showHelpfulInfo(true)
      state = playSong(track.artist, track.track, track.url, nextTrack);
    } else {
      showHelpfulInfo(false)
    }
  }

  nextTrack();

  $('#next').on('click', nextTrack);
} 

function showHelpfulInfo(taggedState) {
  if (taggedState) {
    $('#next').removeClass('hidden');
    $('#tag-info').addClass('hidden');
  } else {
    $('#next').addClass('hidden');
    $('#tag-info').removeClass('hidden');
  }
}


function setUserTable(users) {

  var table = $("#usertarget");
  // Clear the table
  table.html('');
  if (users.length) {
    $.each(users, function (index, user) {
      console.log("User", user.link);
      table.append(
        $('<tr>').append(
            $('<td>').append(
              $('<a>').attr('href', user.link).attr('target', '_blank').text(user.first_name + " " + user.last_name)
            )
          )
        )
    });
  } else {
    table.append(
        $('<tr>').append(
            $('<td>').text("Nobody yet. Tap your card!")
          )
        )
  }
}

