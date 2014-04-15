'use strict';

var crypto = require('crypto');
var fs = require('fs');

function hashFile (local, callback) {
  var shasum = crypto.createHash('sha1');
  var stream = fs.ReadStream(local);
  stream.on('data', shasum.update.bind(shasum));
  stream.on('end', function() {
    callback(null, shasum.digest('hex'));
  });
}

module.exports = hashFile;