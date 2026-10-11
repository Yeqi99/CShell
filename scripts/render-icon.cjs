// Generate all desktop icon sizes from the same vector used in the title bar.
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const svg = await readFile(resolve('assets/icon.svg'), 'utf8');
    const window = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<style>html,body{margin:0;background:transparent;width:256px;height:256px}svg{display:block}</style>${svg}`,
        ),
    );
    const capture = await window.webContents.capturePage();
    const source = nativeImage
      .createFromBuffer(capture.toPNG())
      .resize({ width: 256, height: 256, quality: 'best' });
    await writeFile(resolve('assets/icon.png'), source.toPNG());
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = sizes.map((size) =>
      source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    );
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const position = 6 + index * 16;
      header[position] = header[position + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, position + 4);
      header.writeUInt16LE(32, position + 6);
      header.writeUInt32LE(images[index].length, position + 8);
      header.writeUInt32LE(offset, position + 12);
      offset += images[index].length;
    });
    await writeFile(resolve('assets/icon.ico'), Buffer.concat([header, ...images]));
    window.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
