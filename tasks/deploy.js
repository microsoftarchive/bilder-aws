module.exports = function (grunt) {

  'use strict';

  var ec2 = require('ec2');
  var SSHConnection = require('ssh2');

  var path = require('path');

  var async = grunt.util.async;

  var ec2Client, servers;
  function listServers (callback) {
    // fetch the ec2 config from grunt
    var config = grunt.config.get('env');

    // create the ec2 client to find servers, if it doesn not exist already
    if (!ec2Client) {
      ec2Client = ec2(config.ec2);
    }

    // Find the machine(s) with the env name
    var filters = {
      'Filter.0.Name': 'tag:Name',
      'Filter.0.Value.1': config.ec2.name,
    };

    // Lookup machines by tags
    ec2Client('DescribeInstances', filters, function (err, response) {
      var set = response && response.reservationSet;
      // did we get a valid response ?
      if (err || !set || !set.length) {
        var msg = 'no matching servers found';
        grunt.log.warn(msg);
        setImmediate(callback, new Error(msg));
        return;
      }

      var machines = {
        'all': [],
        'valid': [],
        'dead': []
      };

      set.forEach(function (group) {
        group.instancesSet.forEach(function (machine) {
          // store on the instanceId & the dnsName, rest is useless
          var meta = {
            'id': machine.instanceId,
            'host': machine.dnsName
          };

          // keep a track of all machines
          machines.all.push(meta);

          // skip dead/non-running machines
          if (!machine || machine.instanceState.code !== '16') {
            machines.dead.push(machine.instanceId);
            return;
          }

          // normalize tags for easier filtering
          var tags = {};
          machine.tagSet.forEach(function(tag) {
            tags[tag.key.toLowerCase()] = tag.value;
          });

          // name the machine
          meta.name = config.ec2.name;

          // add the machine to the valid list
          machines.valid.push(meta);
        });
      });

      // return the machines list to the callback
      servers = machines.valid;
      callback(null, machines.valid);
    });
  }

  function connectToServer (server, callback) {
    var config = grunt.config.get('env');
    var connection = new SSHConnection();

    // when connected
    connection.on('connect', function () {
      grunt.log.debug('connected to ' + server.host);
    });

    // when ready to use
    connection.on('ready', function () {
      // validate the connection
      grunt.log.debug('requesting uptime for vaildating connection');
      connection.exec('uptime', function (err, stream) {
        if (err) throw err;
        // trace ssh output in debug mode
        if (!!grunt.option('debug')) {
          stream.on('data', function (message, extended) {
            message = message.toString('utf8');
            var token = 'D';
            if (extended === 'stderr') {
              token = 'E';
              message = message.red;
            }
            grunt.log.writeln('[%s] ', token, message);
          });
        }
        // cache the connection for reuse
        server.connection = connection;
        callback(null);
      });
    });

    // handle errors & disconnection
    connection.on('error', function (err) {
      server.connection = null;
      grunt.log.warn('Failed to connect to ' + server.host);
      callback(err);
    });
    connection.on('end', function () {
      server.connection = null;
      grunt.log.debug('Connection ended : ' + server.host);
    });
    connection.on('close', function () {
      server.connection = null;
      grunt.log.debug('Connection closed : ' + server.host);
    });

    // connect now
    connection.connect({
      'host': server.host,
      'username': config.ssh.user,
      'privateKey': config.ssh.key
    });
  }

  function uploadFile (src, dest, server) {
    return function (callback) {
      src = path.resolve(src);
      // once we have a connection, upload the file(s)
      function upload (err) {
        if (err) throw err;
        grunt.log.debug('uploading: %s => %s', src, dest);
        // get a sftp handle
        server.connection.sftp(function(err, sftp) {
          if (err) throw err;
          // and upload the file
          sftp.fastPut(src, dest, function (err) {
            if (err) throw err;
            grunt.log.debug('uploaded: %s to %s', dest, server.host);
            callback(null);
          });
        });
      }

      // if connection exists, re-use it
      if (server.connection) {
        upload();
      }
      // otherwise connect first
      else {
        connectToServer(server, upload);
      }
    };
  }

  function executeCommand (command, server) {
    return function (callback) {
      // once we have a connection
      function execute (err) {
        if (err) throw err;
        grunt.log.debug('executing: %s', command);
        // execute the command
        server.connection.exec(command, function(err, stream) {
          if (err) throw err;
          // trace ssh output in debug mode
          if (!!grunt.option('debug')) {
            stream.on('data', function (message, extended) {
              message = message.toString('utf8');
              var token = 'D';
              if (extended === 'stderr') {
                token = 'E';
                message = message.red;
              }
              grunt.log.writeln('[%s] ', token, message);
            });
          }

          // handle response
          stream.on('exit', function (code) { //signal
            if (code !== 0) {
              grunt.log.warn('failed to run %s on %s', command, server.host);
            } else {
              grunt.log.debug('executed: %s on %s with code',
                command, server.host, code);
            }
            callback(null);
          });
        });
      }

      // if connection exists, re-use it
      if (server.connection) {
        execute();
      }
      // otherwise connect first
      else {
        connectToServer(server, execute);
      }
    };
  }

  function EC2DeployTask () {

    if (this.args.length) {
      grunt.config('env.deployment.branch', this.args[0]);
    }

    // fetch the options from grunt
    var config = grunt.config.get('env');
    var options =  this.options({
      'uploads': {},
      'commands': []
    });

    // no ENV, no deploy
    if (!config.ec2.name) {
      grunt.log.warn('nothing to deploy; did you forget the ENV');
      return;
    }

    // this is an async task
    var done = this.async();

    // Find the servers
    listServers(function (err, servers) {
      if (err) {
        grunt.log.warn(err.message);
      } else if (!servers.length) {
        grunt.log.warn('no valid servers found');
      } else {
        // deploy to 4 servers at a time,
        // to avoid running out of file descriptors
        async.forEachLimit(servers, 4, function (server, callback) {
          // things to do
          var actions = [];
          // enqueue file uploads
          var uploads = Object.keys(options.uploads);
          uploads.forEach(function (src) {
            var dest = options.uploads[src];
            actions.push(uploadFile(src, dest, server));
          });
          // enqueue command executions
          var commands = options.commands;
          commands.forEach(function (command) {
            actions.push(executeCommand(command, server));
          });
          // roll out
          async.series(actions, function (err) {
            if (err) {
              grunt.log.warn(err.message);
              grunt.log.warn('failed to deploy to: %s', server.host);
              callback(err);
            } else {
              grunt.log.ok(server.id);
              grunt.log.debug('deployed successfully to: %s', server.host);
              setImmediate(callback);
            }
          });
        }, function (err) {
          if (err) {
            grunt.log.warn(err.message);
          } else {
            setImmediate(done);
          }
        });
      }
    });
  }

  grunt.registerMultiTask('bilder/deploy', EC2DeployTask);

};