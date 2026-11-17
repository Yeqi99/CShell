const pro = require('./electron-builder.pro.cjs');
const team = process.env.APPLE_TEAM_ID;
if (!team) throw new Error('APPLE_TEAM_ID is required for macOS distribution');

module.exports = {
  ...pro,
  forceCodeSigning: true,
  mac: { ...pro.mac, identity: team, hardenedRuntime: true, notarize: true },
  dmg: { ...pro.dmg, sign: true },
};
