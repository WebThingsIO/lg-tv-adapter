/**
 * LG TV notifier.
 */
'use strict';

const {
  Notifier,
  Outlet,
} = require('gateway-addon');

class LgTvOutlet extends Outlet {
  /**
   * Initialize the object.
   *
   * @param {Object} notifier - LgTvNotifer object that owns this
   */
  constructor(notifier) {
    super(notifier, `${notifier.device.id}-outlet`);
    this.name = `${notifier.device.name} (Toast)`;
  }

  /**
   * Notify the user.
   *
   * @param {string} title - Title of notification
   * @param {string} message - Message of notification
   * @param {number} level - Alert level
   * @returns {Promise} Promise which resolves when the user has been notified.
   */
  notify(title, message, _level) {
    message = `${title}: ${message}`;
    return new Promise((resolve, reject) => {
      this.notifier.device.client.request(
        'ssap://system.notifications/createToast',
        {
          message,
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
}

/**
 * Notifier for LG TV devices.
 */
class LgTvNotifier extends Notifier {
  /**
   * Initialize the object.
   *
   * @param {Object} addonManager - AddonManagerProxy object
   * @param {Object} device - Device object this notifier is attached to
   */
  constructor(addonManager, device) {
    super(addonManager, `${device.id}-notifier`, addonManager.packageName);
    addonManager.addNotifier(this);

    this.device = device;

    this.handleOutletAdded(new LgTvOutlet(this));
  }
}

module.exports = LgTvNotifier;
