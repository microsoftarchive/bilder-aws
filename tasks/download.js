module.exports = function (grunt) {

  'use strict';

  var async = require('async');

  var download = require('../lib/downloadFile');

  var defaults = {
    'destDir': 'build'
  };

  function S3DownloadTask () {
    var that = this;
    var options = that.options(defaults);
    var done = that.async();

    // init the downloader
    download.init({
      'key': options.key,
      'secret': options.secret,
      'bucket': options.bucket
    });

    var files = that.data.src;
    var fn = function (file, callback) {
      download(options, file, function () {
        grunt.log.ok('\u2713'.green, file);
        process.nextTick(callback);
      });
    };
    async.forEachLimit(files, 4, fn, done);
  }

  grunt.registerMultiTask('bilder/download',
    'Get objects from a s3 bucket', S3DownloadTask);
};
