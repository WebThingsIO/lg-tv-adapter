const {Property} = require('gateway-addon');

class LgTvProperty extends Property {
  /**
   * LG TV property type.
   *
   * @param {Object} device - Device this property belongs to
   * @param {string} name - Name of this property
   * @param {Object} descr - Property description metadata
   * @param {*} value - Current property value
   */
  constructor(device, name, descr, value) {
    super(device, name, descr);
    this.setCachedValue(value);
  }

  /**
   * Set the new property value.
   *
   * @param {*} value - New value
   * @returns {Promise} Promise which resolves when the value has been set
   */
  setValue(value) {
    if (this.readOnly) {
      return Promise.reject('Read-only property');
    }

    if (this.value !== value) {
      return new Promise((resolve, reject) => {
        const cb = (err) => {
          if (err) {
            reject(`Failed to set value: ${err}`);
          } else {
            this.setCachedValue(value);
            this.device.notifyPropertyChanged(this);
            resolve(this.value);
          }
        };

        switch (this.name) {
          case 'volume':
            this.device.client.request(
              'ssap://audio/setVolume',
              {
                volume: value,
              },
              cb
            );
            break;
          case 'mute':
            this.device.client.request(
              'ssap://audio/setMute',
              {
                mute: !!value,
              },
              cb
            );
            break;
        }
      });
    }

    return Promise.resolve();
  }
}

module.exports = LgTvProperty;
