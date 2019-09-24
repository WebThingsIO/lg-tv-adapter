'use strict';

const LgTvAdapter = require('./lib/lg-tv-adapter');

module.exports = (addonManager) => {
  new LgTvAdapter(addonManager);
};
