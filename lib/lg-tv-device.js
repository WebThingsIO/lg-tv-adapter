/**
 * LG TV device type.
 */
'use strict';

const {Device} = require('gateway-addon');
const LgTvProperty = require('./lg-tv-property');
const {promise: ping} = require('ping');

const POLL_INTERVAL = 5000;

/**
 * LG TV device type.
 */
class LgTvDevice extends Device {
  /**
   * Initialize the object.
   *
   * @param {Object} adapter - LgTvAdapter instance
   * @param {string} addr - IP address of device
   * @param {string} mac - MAC address of device
   * @param {Object} client - lgtv2 client object
   */
  constructor(adapter, addr, mac, client) {
    const id = `lg-tv-${mac}`;
    super(adapter, id);

    this.client = client;
    this.addr = addr;
    this.mac = mac;

    this.name = this.description = 'LG webOS TV';
    this['@context'] = 'https://iot.mozilla.org/schemas';
    this['@type'] = ['OnOffSwitch'];

    this.addAction(
      'insertText',
      {
        label: 'Insert Text',
        input: {
          type: 'string',
        },
      }
    );

    this.addAction(
      'deleteText',
      {
        label: 'Delete Text',
        input: {
          type: 'integer',
        },
      }
    );

    this.addAction(
      'createToast',
      {
        label: 'Create Toast',
        input: {
          type: 'string',
        },
      }
    );

    this.addAction(
      'sendKeypress',
      {
        label: 'Send Keypress',
        input: {
          type: 'string',
          enum: [
            'Volume Up',
            'Volume Down',
            'Enter',
            'Delete',
            'Play',
            'Stop',
            'Pause',
            'Rewind',
            'Fast Forward',
            'Power',
            'Channel Down',
            'Channel Up',
            'Left',
            'Right',
            'Up',
            'Down',
            'Click',
            'Home',
            'Back',
            'Ok',
            'Dash',
            'Info',
          ].sort(),
        },
      }
    );

    this.addAction(
      'tuneToChannel',
      {
        label: 'Tune to Channel',
        input: {
          type: 'string',
        },
      }
    );

    this.addAction(
      'openUrl',
      {
        label: 'Open URL',
        input: {
          type: 'string',
        },
      }
    );

    this.properties.set(
      'on',
      new LgTvProperty(
        this,
        'on',
        {
          '@type': 'OnOffProperty',
          label: 'On',
          type: 'boolean',
        },
        true
      )
    );

    this.promises = [];

    this.promises.push(
      new Promise((resolve, reject) => {
        this.client.request(
          'ssap://com.webos.applicationManager/listApps',
          (err, data) => {
            if (err) {
              reject(err);
              return;
            }

            this.apps = data.apps;
            this.addAction(
              'launchApp',
              {
                label: 'Launch App',
                input: {
                  type: 'string',
                  enum: Array.from(
                    new Set(this.apps.map((a) => a.title))
                  ).sort(),
                },
              }
            );
            resolve();
          }
        );
      }).then(() => {
        return new Promise((resolve, reject) => {
          this.client.request(
            'ssap://com.webos.applicationManager/getForegroundAppInfo',
            (err, data) => {
              if (err) {
                reject(err);
                return;
              }

              const app = this.apps.filter((a) => a.id === data.appId);
              const name = app.length > 0 ? app[0].title : null;

              this.properties.set(
                'activeApp',
                new LgTvProperty(
                  this,
                  'activeApp',
                  {
                    label: 'Active App',
                    type: 'string',
                    readOnly: true,
                  },
                  name
                )
              );

              resolve();
            }
          );
        });
      })
    );

    this.promises.push(
      new Promise((resolve, reject) => {
        this.client.request(
          'ssap://audio/getVolume', (err, data) => {
            if (err) {
              reject(err);
              return;
            }

            this.properties.set(
              'volume',
              new LgTvProperty(
                this,
                'volume',
                {
                  label: 'Volume',
                  type: 'integer',
                },
                data.volume
              )
            );

            this.properties.set(
              'mute',
              new LgTvProperty(
                this,
                'mute',
                {
                  label: 'Mute',
                  type: 'boolean',
                },
                data.muted
              )
            );

            resolve();
          }
        );
      })
    );

    try {
      const LgTvNotifier = require('./lg-tv-notifier');
      new LgTvNotifier(this.adapter.manager, this);
    } catch (e) {
      if (!(e instanceof TypeError)) {
        console.error(e);
      }
    }

    setInterval(this.poll.bind(this), POLL_INTERVAL);
  }

  async checkPing(ip) {
    try {
      const result = await ping.probe(ip);
      this.setOn(result.alive);
    } catch (e) {
      this.setOn(false);
    }
  }

  setOn(on) {
    const prop = this.findProperty('on');
    if (prop && prop.value !== on) {
      prop.setCachedValue(on);
      this.notifyPropertyChanged(prop);
    }
  }

  /**
   * Poll current status.
   */
  poll() {
    this.client.request(
      'ssap://com.webos.applicationManager/getForegroundAppInfo',
      (err, data) => {
        if (err) {
          return;
        }

        const app = this.apps.filter((a) => a.id === data.appId);
        const name = app.length > 0 ? app[0].title : null;

        const prop = this.properties.get('activeApp');
        if (prop.value !== name) {
          prop.setCachedValue(name);
          this.notifyPropertyChanged(prop);
        }
      }
    );

    this.client.request(
      'ssap://audio/getVolume', (err, data) => {
        if (err) {
          return;
        }

        const volumeProp = this.properties.get('volume');
        const muteProp = this.properties.get('mute');

        if (volumeProp.value !== data.volume) {
          volumeProp.setCachedValue(data.volume);
          this.notifyPropertyChanged(volumeProp);
        }

        if (muteProp.value !== data.muted) {
          muteProp.setCachedValue(data.muted);
          this.notifyPropertyChanged(muteProp);
        }
      }
    );
  }

  /**
   * Perform an action.
   *
   * @param {Object} action - Action to perform
   */
  performAction(action) {
    return new Promise((resolve) => {
      switch (action.name) {
        case 'openUrl':
          action.start();
          this.client.request(
            'ssap://system.launcher/open',
            {
              target: action.input,
            },
            (err) => {
              if (err) {
                console.error(`Failed to open URL: ${err}`);
                action.status = 'error';
                this.actionNotify(action);
              } else {
                action.finish();
              }

              resolve();
            }
          );
          break;
        case 'createToast':
          action.start();
          this.client.request(
            'ssap://system.notifications/createToast',
            {
              message: action.input,
            },
            (err) => {
              if (err) {
                console.error(`Failed to create toast: ${err}`);
                action.status = 'error';
                this.actionNotify(action);
              } else {
                action.finish();
              }

              resolve();
            }
          );
          break;
        case 'tuneToChannel':
          action.start();
          this.client.request(
            'ssap://tv/openChannel',
            {
              channelNumber: action.input,
            },
            (err) => {
              if (err) {
                console.error(`Failed to tune to channel: ${err}`);
                action.status = 'error';
                this.actionNotify(action);
              } else {
                action.finish();
              }

              resolve();
            }
          );
          break;
        case 'launchApp': {
          action.start();

          const app = this.apps.filter((a) => a.title === action.input);
          if (app.length === 0) {
            console.error(`App not found: ${action.input}`);
            action.status = 'error';
            this.actionNotify(action);
            resolve();
          } else {
            this.client.request(
              'ssap://system.launcher/launch',
              {
                id: app[0].id,
              },
              (err) => {
                if (err) {
                  console.error(`Failed to launch app: ${err}`);
                  action.status = 'error';
                  this.actionNotify(action);
                } else {
                  action.finish();
                }

                resolve();
              }
            );
          }

          break;
        }
        case 'insertText':
          action.start();
          this.client.request(
            'ssap://com.webos.service.ime/insertText',
            {
              text: action.input,
              replace: 0,
            },
            (err) => {
              if (err) {
                console.error(`Failed to send insert text: ${err}`);
                action.status = 'error';
                this.actionNotify(action);
              } else {
                action.finish();
              }

              resolve();
            }
          );
          break;
        case 'deleteText':
          this.client.request(
            'ssap://com.webos.service.ime/deleteCharacters',
            {
              count: action.input,
            },
            (err) => {
              if (err) {
                console.error(`Failed to send delete text: ${err}`);
                action.status = 'error';
                this.actionNotify(action);
              } else {
                action.finish();
              }

              resolve();
            }
          );
          break;
        case 'sendKeypress': {
          const cb = (err) => {
            if (err) {
              console.error(`Failed to send keypress: ${err}`);
              action.status = 'error';
              this.actionNotify(action);
            } else {
              action.finish();
            }

            resolve();
          };

          action.start();

          switch (action.input) {
            case 'Volume Up':
              this.client.request('ssap://audio/volumeUp', cb);
              break;
            case 'Volume Down':
              this.client.request('ssap://audio/volumeDown', cb);
              break;
            case 'Enter':
              this.client.request(
                'ssap://com.webos.service.ime/sendEnterKey',
                cb
              );
              break;
            case 'Play':
              this.client.request('ssap://media.controls/play', cb);
              break;
            case 'Stop':
              this.client.request('ssap://media.controls/stop', cb);
              break;
            case 'Pause':
              this.client.request('ssap://media.controls/pause', cb);
              break;
            case 'Rewind':
              this.client.request('ssap://media.controls/rewind', cb);
              break;
            case 'Fast Forward':
              this.client.request('ssap://media.controls/fastForward', cb);
              break;
            case 'Power':
              this.client.request('ssap://system/turnOff', cb);
              break;
            case 'Channel Down':
              this.client.request('ssap://tv/channelDown', cb);
              break;
            case 'Channel Up':
              this.client.request('ssap://tv/channelUp', cb);
              break;
            case 'Click':
            case 'Left':
            case 'Right':
            case 'Up':
            case 'Down':
            case 'Home':
            case 'Back':
            case 'Ok':
            case 'Dash':
            case 'Info':
              this.client.getSocket(
                'ssap://com.webos.service.networkinput/getPointerInputSocket',
                (err, sock) => {
                  if (err) {
                    console.error(`Failed to send keypress: ${err}`);
                    action.status = 'error';
                    this.actionNotify(action);
                    resolve();
                    return;
                  }

                  if (action.input === 'Click') {
                    sock.send('click', {});
                  } else {
                    sock.send('button', {name: action.input.toUpperCase()});
                  }

                  resolve();
                }
              );
              break;
            default:
              console.error(`Unknown key: ${action.input}`);
              action.status = 'error';
              this.actionNotify(action);
              resolve();
              break;
          }

          break;
        }
        default:
          action.status = 'error';
          this.actionNotify(action);
          resolve();
          break;
      }
    });
  }
}

module.exports = LgTvDevice;
