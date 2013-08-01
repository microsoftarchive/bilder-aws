module.exports = function(grunt, options) {

  'use strict';

  function S3SyncTask () {

  }

  grunt.registerTask('s3/sync', 'Sync S3 folders to EC2 machines', S3SyncTask);
};
