'use strict';

var fs = require('fs');
var path = require('path');
var knox = require('knox');
var zlib = require('zlib');

var downloader;
function init (options) {
  downloader = knox.createClient(options);
}

function downloadFile (options, file, callback) {
  var remote = path.join(options.baseDir, file);
  var local = path.resolve(options.destDir, file);

  downloader.getFile(remote, function (err, response) {
    var isGzip = (response.headers['content-encoding'] === 'gzip');
    var stream = fs.createWriteStream(local);
    if (isGzip) {
      var gunzip = zlib.createGunzip();
      response.pipe(gunzip).pipe(stream);
    } else {
      response.pipe(stream);
    }

    stream.on('finish', function () {
      setImmediate(callback, null, local);
    });
  });
}

module.exports = downloadFile;
downloadFile.init = init;
