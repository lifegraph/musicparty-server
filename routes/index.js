
exports.root = function(req, res) {
	res.render('index', {
    profile: req.session.profile
  });
}

