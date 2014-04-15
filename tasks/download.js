module.exports = function(grunt, options) {

  'use strict';

  function S3DownloadTask () {

  }

  grunt.registerTask('bilder/download', 'Get objects from a s3 bucket', S3DownloadTask);
};
