if(process.argv.includes('--account-source-export')) {
  void import('./account-source-export').then(module=>module.runSourceExport());
} else {
  void import('./main');
}
