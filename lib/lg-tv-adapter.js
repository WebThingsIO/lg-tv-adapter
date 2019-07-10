/**
 * LG TV adapter.
 */
'use strict';

const {Adapter} = require('gateway-addon');
const {Client} = require('node-ssdp');
const findDevices = require('local-devices');
const ipRegex = require('ip-regex')({exact: true});
const LGTV = require('lgtv2');
const LgTvDatabase = require('./lg-tv-database');
const LgTvDevice = require('./lg-tv-device');
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
   * @param {Object} manifest - Package manifest
   */
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);

    this.knownDevices = new Set();
    this.config = manifest.moziot.config;

    this.arpTable = {};
    this.setupSsdpClient();

    const refresh = () => {
      this.refreshArpTable().then(() => {
        this.addKnownDevices();
        this.ssdpClient.search(SSDP_SERVICE);
      });
    };

    refresh();
    this.interval = setInterval(refresh, 30000);
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
   * Refresh the cached ARP table.
   *
   * @returns {Promise} Promise which resolves when the refresh completes.
   */
  refreshArpTable() {
    return findDevices().then((devices) => {
      for (const dev of devices) {
        this.arpTable[dev.ip] = dev.mac;
      }
    }).catch((e) => {
      console.warn('Error while refreshing ARP table:', e);
    }).then(() => {
      for (const device of Object.values(this.devices)) {
        let addr = null;

        for (const [ip, mac] of Object.entries(this.arpTable)) {
          if (device.mac === mac) {
            addr = ip;
            break;
          }
        }

        if (addr) {
          device.checkPing(addr);
        } else {
          device.setOn(false);
        }
      }
    });
  }

  /**
   * Get the MAC address for a given IP address.
   *
   * @param {string} addr - IP address
   * @returns {string} MAC address
   */
  getMac(addr) {
    return this.arpTable[addr] || '00:00:00:00:00:00';
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
      this.addDevice(addr);
    }
  }

  /**
   * Setup the SSDP client for discovery.
   */
  setupSsdpClient() {
    this.ssdpClient = new Client();
    this.ssdpClient.on('response', (headers) => {
      const url = new URL(headers.LOCATION);
      const addr = url.hostname;
      this.addDevice(addr);
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

    if (this.knownDevices.has(addr)) {
      return;
    }

    const mac = this.getMac(addr);
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
          this.knownDevices.add(addr);
        }).catch((e) => {
          console.error(`Failed to create device: ${e}`);
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
    this.knownDevices.delete(device.addr);
    if (this.devices.hasOwnProperty(device.id)) {
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
