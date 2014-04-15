module.exports = function (grunt) {

  'use strict';

  var fs = require('fs');
  var path = require('path');
  var crypto = require('crypto');
  var zlib = require('zlib');

  var async = require('async');
  var mime = require('mime');
  var knox = require('knox');
  var debounce = require('debounce');

  var tmp = require('tmp');
  tmp.setGracefulCleanup();

  var cache;
  var cacheFile = path.resolve(process.env.HOME, '.s3.cache.json');
  try {
    cache = require(cacheFile);
  } catch (e) {
    cache = {};
  }

  var defaults = {
    'throttle': 10,
    'hash': true,
    'gzip': false,
    'baseDir': 'public',
    'buildDir': 'build',
    'prefix': ''
  };

  var encodingOptions = { 'encoding': 'utf8' };
  var updateCache = debounce(function (key) {
    if (key) {
      cache[key] = true;
    }
    var data = JSON.stringify(cache, null, 2);
    fs.writeFileSync(cacheFile, data, encodingOptions);
  }, 50, true);

  function hashFile (local, callback) {
    var shasum = crypto.createHash('sha1');
    var stream = fs.ReadStream(local);
    stream.on('data', shasum.update.bind(shasum));
    stream.on('end', function() {
      callback(null, shasum.digest('hex'));
    });
  }

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

  var uploader;
  function upload (name, local, remote, isGzip, callback) {

    var headers = {
      'Content-Type': mime.lookup(name),
      'Content-Length': fs.statSync(local).size,
      'x-amz-acl': 'public-read',
      'Access-Control-Allow-Origin': '*'
    };

    if (isGzip) {
      headers['Content-Encoding'] = 'gzip';
    }

    var stream = fs.ReadStream(local);
    uploader.putStream(stream, remote, headers, function (err, response) {
      if (err || response.statusCode !== 200) {
        // TODO: add re-trial
        grunt.log.error('\u2717'.red, name);
      } else {
        grunt.log.ok('\u2713'.green, name);
        updateCache(remote);
        process.nextTick(function () {
          callback(null, remote);
        });
      }
    });
  }

  function processFile (options, file, callback) {
    // get the absolute path
    var original = file;
    var name = path.basename(original);
    var local = path.resolve(options.baseDir, file);

    // resolve the file, if it's a sym-link
    var fileStat = fs.lstatSync(local);
    while (fileStat && fileStat.isSymbolicLink() && !fileStat.isFile()) {
      local = path.resolve(path.dirname(local), fs.readlinkSync(local));
      fileStat = fs.lstatSync(local);
    }

    var prefix = options.prefix;
    var args = [
      name,
      local,
      null,
      !!options.gzip,
      callback
    ];

    hashFile(local, function (err, shasum) {
      // path on the bucket
      var remote = args[2] = options.hash ?
                path.join(prefix, shasum, original)
               :path.join(prefix, original);

      // skip upload, if already uploaded
      if (options.hash && cache[remote]) {
        grunt.log.debug('\u25C8'.yellow, name);
        return callback(null, remote);
      }
      // for gzip'd files, create a temp file & upload that instead
      else if (options.gzip) {
        gzipFile(local, function (err, gzFile) {
          args[1] = gzFile;
          upload.apply(null, args);
        });
        return;
      }
      // everything else, just upload it right away
      else {
        upload.apply(null, args);
      }
    });
  }

  function S3UploadTask () {

    var that = this;

    var options = this.options(defaults);
    var done = that.async();
    var files = grunt.file.expand({
      'cwd': options.baseDir
    }, that.data.src);

    var fn = processFile.bind(null, options);

    // init the uploader
    uploader = knox.createClient({
      'key': options.key,
      'secret': options.secret,
      'bucket': options.bucket
    });

    var max = options.throttle;
    async.mapLimit(files, max, fn, function (err, remotes) {
      var map = {};
      remotes.forEach(function (remote, index) {
        map[files[index]] = remote;
      });
      var mapFile = path.resolve(options.buildDir, that.target + '.json');
      fs.writeFileSync(mapFile, JSON.stringify(map, null, 2), encodingOptions);

      setTimeout(done, 200);
    });
  }

  grunt.registerTask('bilder/s3', 'Upload to S3 bucket', S3UploadTask);
};
