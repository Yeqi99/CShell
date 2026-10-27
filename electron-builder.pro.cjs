const {build: base, version} = require('./package.json');
module.exports = {...base, appId:'org.canpshell.pro', productName:'CShell Pro',
 extraMetadata:{name:'canpshell-pro',productName:'CShell Pro'},
 directories:{output:`release/pro-${version}`}, artifactName:'CShell-Pro-${version}-${os}-${arch}.${ext}',
 files:[...base.files,'assets/brand/cshell-pro.png'],
 win:{...base.win,icon:'assets/brand/cshell-pro.ico'},
 mac:{...base.mac,icon:'assets/brand/cshell-pro-512.png'},
 linux:{...base.linux,icon:'assets/brand/cshell-pro.png'}};
