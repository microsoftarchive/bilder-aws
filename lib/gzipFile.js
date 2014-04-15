'use strict';

var fs = require('fs');
var zlib = require('zlib');

var tmp = require('tmp');
tmp.setGracefulCleanup();

function gzipFile (local, callback) {
  tmp.file(function (err, gzipped) {
    var gzip = zlib.createGzip();
    var inStream = fs.ReadStream(local);
    var outStream = fs.WriteStream(gzipped);
    inStream.pipe(gzip).pipe(outStream);
    inStream.on('end', function() {
      setTimeout(function () {
        callback(null, gzipped);
      }, 100);
    });
  });
}

module.exports = gzipFile;