'use strict';

const LgTvAdapter = require('./lib/lg-tv-adapter');

module.exports = (addonManager, manifest) => {
  new LgTvAdapter(addonManager, manifest);
};
