module.exports = function (grunt) {

  'use strict';

  var spawn = require('child_process').spawn;
  var ec2 = require('ec2');
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

  function debug (ssh) {
    if (!!grunt.option('debug')) {
      ssh.stdout.on('data', function (data) {
        grunt.log.writeln('[D] ', data.toString('utf8'));
      });
      ssh.stderr.on('data', function (data) {
        grunt.log.writeln('[E] ', data.toString('utf8').red);
      });
    }
  }

  function uploadFileCmd (src, dest, server) {
    return function (callback) {
      grunt.log.debug('uploading to %s: %s => %s', server.id, src, dest);
      src = path.resolve(src);
      var ssh = spawn('scp', [src, [server.host, dest].join(':')]);
      debug(ssh);
      ssh.on('close', function (code) {
        if (code !== 0) {
          grunt.log.fatal('failed uploading %s to %s', src, server.id);
        }
        grunt.log.ok(src, server.id);
        callback(null);
      });
    };
  }

  function executeCommandCmd (command, server) {
    return function (callback) {
      grunt.log.debug('executing %s on %s => %s', command, server.id);
      var ssh = spawn('ssh', [server.host, command]);
      debug(ssh);
      ssh.on('close', function (code) {
        if (code !== 0) {
          grunt.log.fatal('failed executing %s on %s', command, server.id);
        }
        grunt.log.ok(command, server.id);
        callback(null);
      });
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
            actions.push(uploadFileCmd(src, dest, server));
          });
          // enqueue command executions
          var commands = options.commands;
          commands.forEach(function (command) {
            actions.push(executeCommandCmd(command, server));
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