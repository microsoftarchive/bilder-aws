'use strict';

var mime = require('mime');
var knox = require('knox');

var path = require('path');
var fs = require('fs');

var cache;
var cacheFile = path.resolve(process.env.HOME, '.s3.cache.json');
try {
  cache = require(cacheFile);
} catch (e) {
  cache = {};
}

var encodingOptions = { 'encoding': 'utf8' };
var now = new Date();
now.setDate(now.getDate() + 365);
var nextYear = now.toGMTString();

function saveCache (key) {
  if (key) {
    cache[key] = true;
  }
  var data = JSON.stringify(cache, null, 2);
  fs.writeFileSync(cacheFile, data, encodingOptions);
}

var uploader;
function init (options) {
  uploader = knox.createClient(options);
}

function upload (name, local, remote, isGzip, callback) {

  var headers = {
    'Content-Type': mime.lookup(name),
    'Content-Length': fs.statSync(local).size,
    'x-amz-acl': 'public-read',
    'Cache-Control': 'public',
    'Expires': nextYear,
    'Access-Control-Allow-Origin': '*'
  };

  if (isGzip) {
    headers['Content-Encoding'] = 'gzip';
  }

  var stream = fs.ReadStream(local);
  uploader.putStream(stream, remote, headers, function (err, response) {
    if (err || response.statusCode !== 200) {
      // TODO: add re-trial
      callback(new Error('failed'));
    } else {
      saveCache(remote);
      process.nextTick(function () {
        callback(null, remote);
      });
    }
  });
}

upload.cache = cache;
upload.init = init;
module.exports = upload;
