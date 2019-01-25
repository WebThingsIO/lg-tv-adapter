/**
 * LG TV adapter.
 */
'use strict';

const {Adapter} = require('gateway-addon');
const {Client} = require('node-ssdp');
const {getMAC} = require('arp');
const LGTV = require('lgtv2');
const LgTvDatabase = require('./lg-tv-database');
const LgTvDevice = require('./lg-tv-device');
const {URL} = require('url');

/**
 * Adapter for LG TV devices.
 */
class LgTvAdapter extends Adapter {
  /**
   * Initialize the object.
   *
   * @param {Object} addonManager - AddonManagerProxy object
   * @param {Object} manifest - Package manifest
   */
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);

    this.knownDevices = new Set();
    this.config = manifest.moziot.config;

    this.addKnownDevices();
    this.startSearch();
  }

  /**
   * Save a key to the database.
   *
   * @param {string} mac - MAC address of device
   * @param {string} key - Key to store
   * @param {function} cb - Error callback
   * @returns {Promise} Promise which resolves when the key has been saved.
   */
  saveKey(mac, key, cb) {
    const database = new LgTvDatabase(this.packageName);
    return database.open().then(() => {
      return database.storePairingData(mac, key);
    }).then(() => {
      database.close();
    }).catch((e) => {
      console.error(`Failed to store pairing data: ${e}`);
      cb(e);
    });
  }

  /**
   * Load a key from the database.
   *
   * @param {string} mac - MAC address of device
   * @returns {Promise} Promise which resolves to the stored key or null.
   */
  loadKey(mac) {
    const database = new LgTvDatabase(this.packageName);
    return database.open().then(() => {
      return database.loadPairingData(mac);
    }).then((data) => {
      database.close();
      return data;
    }).catch((e) => {
      console.error(`Failed to load pairing data: ${e}`);
      return null;
    });
  }

  /**
   * Attempt to add any configured devices.
   */
  addKnownDevices() {
    for (const addr of this.config.devices) {
      if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(addr)) {
        continue;
      }

      this.knownDevices.add(addr);

      getMAC(addr, (err, data) => {
        if (err) {
          console.error(`Failed to get MAC for ${addr}: ${data}`);
          return;
        }

        this.loadKey(data).then((clientKey) => {
          const client = new LGTV({
            url: `ws://${addr}:3000`,
            saveKey: (key, cb) => {
              this.saveKey(data, key, cb);
            },
            clientKey,
          });
          client.on('error', (e) => {
            console.error(`Failed to connect to device: ${e}`);
          });
          client.on('connect', () => {
            const dev = new LgTvDevice(
              this,
              '[LG] webOS TV',
              addr,
              data,
              client
            );
            Promise.all(dev.promises).then(() => {
              this.handleDeviceAdded(dev);
            }).catch((e) => {
              console.error(`Failed to create device: ${e}`);
            });
          });
        });
      });
    }
  }

  /**
   * Start the discovery process.
   */
  startSearch() {
    const ssdpClient = new Client();
    ssdpClient.on('response', (headers) => {
      if (headers.hasOwnProperty('DLNADEVICENAME.LGE.COM')) {
        const name = decodeURIComponent(headers['DLNADEVICENAME.LGE.COM']);
        if (name.startsWith('[LG] webOS TV')) {
          const url = new URL(headers.LOCATION);
          const addr = url.hostname;

          if (this.knownDevices.has(addr)) {
            return;
          }

          this.knownDevices.add(addr);

          getMAC(addr, (err, data) => {
            if (err) {
              console.error(`Failed to get MAC for ${addr}: ${data}`);
              return;
            }

            this.loadKey(data).then((clientKey) => {
              const client = new LGTV({
                url: `ws://${addr}:3000`,
                saveKey: (key, cb) => {
                  this.saveKey(data, key, cb);
                },
                clientKey,
              });
              client.on('error', (e) => {
                console.error(`Failed to connect to device: ${e}`);
              });
              client.on('connect', () => {
                const dev = new LgTvDevice(this, name, addr, data, client);
                Promise.all(dev.promises).then(() => {
                  this.handleDeviceAdded(dev);
                }).catch((e) => {
                  console.error(`Failed to create device: ${e}`);
                });
              });
            });
          });
        }
      }
    });
    ssdpClient.search('urn:schemas-upnp-org:device:MediaRenderer:1');
  }

  /**
   * Remove a device from this adapter.
   *
   * @param {Object} device - The device to remove
   * @returns {Promise} Promise which resolves to the removed device.
   */
  removeThing(device) {
    this.knownDevices.delete(device.addr);
    if (this.devices.hasOwnProperty(device.id)) {
      this.handleDeviceRemoved(device);
    }

    return Promise.resolve(device);
  }
}

module.exports = LgTvAdapter;
