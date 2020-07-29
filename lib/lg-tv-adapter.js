/**
 * LG TV adapter.
 */
'use strict';

const {Adapter} = require('gateway-addon');
const {Client} = require('node-ssdp');
const findDevice = require('local-devices');
const ipRegex = require('ip-regex')({exact: true});
const LGTV = require('lgtv2');
const LgTvDatabase = require('./lg-tv-database');
const LgTvDevice = require('./lg-tv-device');
const manifest = require('../manifest.json');
const {URL} = require('url');

const SSDP_SERVICE = 'urn:lge-com:service:webos-second-screen:1';

/**
 * Adapter for LG TV devices.
 */
class LgTvAdapter extends Adapter {
  /**
   * Initialize the object.
   *
   * @param {Object} addonManager - AddonManagerProxy object
   */
  constructor(addonManager) {
    super(addonManager, manifest.id, manifest.id);
    addonManager.addAdapter(this);

    this.setupSsdpClient();

    const refresh = () => {
      this.addKnownDevices();
      this.ssdpClient.search(SSDP_SERVICE);
    };

    this.db = new LgTvDatabase(this.packageName);
    this.db.open().then(() => {
      return this.db.loadConfig();
    }).then((config) => {
      this.config = config;

      refresh();
      this.interval = setInterval(refresh, 30000);
    }).catch(console.error);
  }

  /**
   * Start the pairing process.
   *
   * For this adapter, that's always happening in the background, but we should
   * send a pairing prompt if we can.
   */
  startPairing() {
    if (this.sendPairingPrompt) {
      this.sendPairingPrompt(
        // eslint-disable-next-line max-len
        'Enable LG Connect Apps and accept the pairing request on your TV when prompted.',
        'https://github.com/mozilla-iot/lg-tv-adapter#readme'
      );
    }
  }

  /**
   * Get the MAC address for a given IP address.
   *
   * @param {string} addr - IP address
   * @returns {string} MAC address
   */
  getMac(addr) {
    const parseMac = (dev) => {
      if (dev && dev.mac) {
        return dev.mac;
      }

      return '00:00:00:00:00:00';
    };

    return findDevice(addr).then(parseMac, parseMac);
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
    return this.db.storePairingData(mac, key).catch((e) => {
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
    return this.db.loadPairingData(mac).catch((e) => {
      console.error(`Failed to load pairing data: ${e}`);
      return null;
    });
  }

  /**
   * Attempt to add any configured devices.
   */
  addKnownDevices() {
    for (const addr of this.config.devices) {
      this.addDevice(addr);
    }
  }

  /**
   * Setup the SSDP client for discovery.
   */
  setupSsdpClient() {
    this.ssdpClient = new Client();
    this.ssdpClient.on('response', (headers) => {
      if (headers.ST === SSDP_SERVICE) {
        const url = new URL(headers.LOCATION);
        const addr = url.hostname;
        this.addDevice(addr);
      }
    });
  }

  /**
   * Create a new device from the IP address.
   *
   * @param {string} addr IP address
   */
  addDevice(addr) {
    if (!ipRegex.test(addr)) {
      return;
    }

    this.getMac(addr).then((mac) => {
      if (mac === '00:00:00:00:00:00') {
        return;
      }

      const id = `lg-tv-${mac}`;
      if (id in this.devices) {
        if (this.devices[id].addr === addr) {
          this.devices[id].setOn(true);
          return;
        }

        this.removeThing(this.devices[id]);
      }

      this.loadKey(mac).then((clientKey) => {
        const client = new LGTV({
          url: `ws://${addr}:3000`,
          saveKey: (key, cb) => {
            this.saveKey(mac, key, cb);
          },
          clientKey,
        });
        client.on('error', (e) => {
          console.error(`Failed to connect to device: ${e}`);
        });
        client.on('connect', () => {
          const dev = new LgTvDevice(this, addr, mac, client);
          Promise.all(dev.promises).then(() => {
            this.handleDeviceAdded(dev);
          }).catch((e) => {
            console.error(`Failed to create device: ${e}`);
          });
        });
      });
    });
  }

  /**
   * Remove a device from this adapter.
   *
   * @param {Object} device - The device to remove
   * @returns {Promise} Promise which resolves to the removed device.
   */
  removeThing(device) {
    if (this.devices.hasOwnProperty(device.id)) {
      device.unload();
      this.handleDeviceRemoved(device);
    }

    return Promise.resolve(device);
  }

  /**
   * Clean up before shutting down.
   */
  unload() {
    if (this.interval) {
      clearInterval(this.interval);
      delete this.interval;
    }

    if (this.ssdpClient) {
      this.ssdpClient.stop();
      delete this.ssdpClient;
    }

    return super.unload();
  }
}

module.exports = LgTvAdapter;
