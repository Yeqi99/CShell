const { build } = require('../package.json');
module.exports = {
  ...build,
  appId: 'org.canpshell.client',
  productName: 'CShell Client',
  directories: { output: 'release/client-0.1.0' },
  extraMetadata: { name: 'cshell-client', productName: 'CShell Client', version: '0.1.0' },
  artifactName: 'CShell-Client-${version}-win-${arch}.${ext}',
};
