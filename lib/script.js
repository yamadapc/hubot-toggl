'use strict';
var buffer = require('buffer');
var _ = require('lodash');
var moment = require('moment');

var Buffer = buffer.Buffer;

function hubotToggl(robot) {
  robot.logger.info("hubot-toggl: Starting the Toggl robot");

  robot.respond(/toggl setup( (.*))?/, function(res) {
    var token = res.match[2];

    var isPrivateMessage = res.envelope.room === res.envelope.user.name;

    if(!isPrivateMessage) {
      res.reply('I can only authenticate you with a Private Message');
      robot.send({room: res.envelope.user.name}, 'Send me `toggl setup <token>`');
      return;
    }

    var username = res.envelope.user.name;

    if(!token) {
      res.send('Please send `toggl setup <token>`');
      return;
    }

    var user = robot.brain.userForName(username);
    res.send('Validating your token');
    robot.http('https://toggl.com/api/v8/me')
      .header(
        'Authorization',
        'Basic ' + new Buffer(token + ':api_token').toString('base64')
      )
      .get()(function(err, _httpRes, body) {
        if(_httpRes.statusCode === 200) {
          body = JSON.parse(body);
          res.send(
            '_Authenticated as:_ *' + body.data.fullname + '*\n' +
            '_User ID:_ *' + body.data.id + '*\n' +
            '_Default Workspace ID:_ *' + body.data.default_wid + '*\n' +
            '\n\n' +
            'Your Toggl data should be persisted. Try `toggl start <description>`'
          );
          user.toggl = {
            me: body,
          };
          robot.brain.save();
        } else {
          res.send(
            'Failed to fetch Toggl data (HTTP ' + _httpRes.statusCode + ')'
          );
        }
      });
  });

  robot.respond(/toggl whoami/, function(res) {
    var username = res.envelope.user.name;
    var user = robot.brain.userForName(username);

    if(!user.toggl.me) {
      res.send('No Toggl Account set-up. Try: `toggl setup <token>`');
      return;
    }

    var me = user.toggl.me;
    res.send(
      '_Authenticated as:_ *' + me.data.fullname + '*\n' +
      '_User ID:_ *' + me.data.id + '*\n' +
      '_Default Workspace ID:_ *' + me.data.default_wid + '*\n' +
      '\n\n' +
      'Try `toggl start <description>`'
    );
  });

  robot.respond(/toggl current/, function(res) {
    var username = res.envelope.user.name;
    var user = robot.brain.userForName(username);

    if(!user.toggl.me) {
      res.send('No Toggl Account set-up. Try: `toggl setup <token>`');
      return;
    }

    var me = user.toggl.me;
    robot.http('https://toggl.com/api/v8/time_entries/current')
      .header(
        'Authorization',
        'Basic ' + new Buffer(me.data.api_token + ':api_token').toString('base64')
      )
      .get()(function(err, _httpRes, body) {
        if(_httpRes.statusCode !== 200) {
          res.send('Failed to find a time-entry (HTTP ' + _httpRes.statusCode + ')');
          return;
        }

        body = JSON.parse(body);

        if(!body.data) {
          res.send(
            'No current time-entry found. Try `toggl start <description>`'
          );
          return;
        }

        res.send(
          '*Description:* ' + body.data.description + '\n' +
          '*Started at:* ' + body.data.start
        );
      });
  });

  robot.respond(/toggl start( (.*))?/, function(res) {
    var username = res.envelope.user.name;
    var user = robot.brain.userForName(username);

    if(!user.toggl.me) {
      res.send('No Toggl Account set-up. Try: `toggl setup <token>`');
      return;
    }

    var me = user.toggl.me;
    robot.http('https://toggl.com/api/v8/time_entries')
      .header(
        'Authorization',
        'Basic ' + new Buffer(me.data.api_token + ':api_token').toString('base64')
      )
      .header('Content-Type', 'application/json')
      .post(JSON.stringify({
        time_entry: {
          description: res.match[2],
          start: moment().format(),
          created_with: 'hubot',
          duration: - new Date().getTime() / 1000
        }
      }))(function(err, _httpRes, body) {
        if(_httpRes.statusCode === 200) {
          body = JSON.parse(body);
          res.send('Started time-entry *(' + body.data.id + ')*');
        } else {
          res.send('Failed to start a time-entry (HTTP ' + _httpRes.statusCode + ')');
        }
      });
  });

  robot.respond(/toggl stop/, function(res) {
    var username = res.envelope.user.name;
    var user = robot.brain.userForName(username);

    if(!user.toggl.me) {
      res.send('No Toggl Account set-up. Try: `toggl setup <token>`');
      return;
    }

    var me = user.toggl.me;
    robot.http('https://toggl.com/api/v8/time_entries/current')
      .header(
        'Authorization',
        'Basic ' + new Buffer(me.data.api_token + ':api_token').toString('base64')
      )
      .get()(function(err, _httpRes, body) {
        if(_httpRes.statusCode === 200) {
          body = JSON.parse(body);
          var currentId = body.data.id;
          robot.http('https://toggl.com/api/v8/time_entries/' + currentId)
            .header(
              'Authorization',
              'Basic ' + new Buffer(me.data.api_token + ':api_token').toString('base64')
            )
            .put(JSON.stringify({
              time_entry: _.extend(body.data, {
                stop: moment().format(),
                duration:
                  (new Date().getTime() -
                   moment.parseZone(body.data.start).toDate().getTime()) /
                  1000
              }),
            }))(function(err, _httpRes, body) {
              if(_httpRes.statusCode !== 200) {
                res.send('Failed to stop time-entry ' + currentId + ' (HTTP ' + _httpRes.statusCode + ')');
                return;
              }

              body = JSON.parse(body);
              res.send('Stopped time-entry *(' + currentId + ')*');
            });
        } else {
          res.send('Failed to find a time-entry (HTTP ' + _httpRes.statusCode + ')');
        }
      });
  });

  robot.respond(/toggl projects/, function(res) {
    var username = res.envelope.user.name;
    var user = robot.brain.userForName(username);

    if(!user.toggl || !user.toggl.me) {
      res.send('No Toggl Account set-up. Try: `toggl setup <token>`');
      return;
    }

    var me = user.toggl.me;
    var projectsUrl = 'https://toggl.com/api/v8/workspaces/' +
      me.data.default_wid +
      '/projects';

    res.send('Finding the last 5 projects to be updated');
    robot.http(projectsUrl)
      .header(
        'Authorization',
        'Basic ' + new Buffer(me.data.api_token + ':api_token').toString('base64')
      )
      .get()(function(err, _httpRes, body) {
        if(_httpRes.statusCode === 200) {
          body = JSON.parse(body);
          res.send(
            _(body)
              .sortBy(function(project) {
                return moment.parseZone(project.at).toDate().getTime();
              })
              .take(5)
              .pluck('name')
              .map(function(n) {
                return '• ' + n;
              })
              .value()
              .join('\n')
          );
        } else {
          res.send('Failed to find projects (HTTP ' + _httpRes.statusCode + ')');
        }
      });
  });
}

exports = module.exports = hubotToggl;
