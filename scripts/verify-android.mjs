import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const apk = resolve(process.argv[2] || 'android/app/build/outputs/apk/release/app-release.apk');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME is required to verify the actual APK');
const installed = (await readdir(join(sdk, 'build-tools')))
  .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
if (!installed.length) throw new Error('Android build-tools missing');
const tools = join(sdk, 'build-tools', installed[0]);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const identity = JSON.parse(
  await readFile(new URL('./android-release-identity.json', import.meta.url), 'utf8'),
);
const [major, minor, patch] = version.split('.').map(Number);
const code = major * 1000000 + minor * 1000 + patch;
const badging = execFileSync(
  join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
  ['dump', 'badging', apk],
  { encoding: 'utf8', windowsHide: true },
);
const pkg = /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m.exec(badging);
if (!pkg || pkg[1] !== identity.packageName || pkg[2] !== String(code) || pkg[3] !== version)
  throw new Error('APK package/version does not match package.json');
const java = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : 'java';
const signature = execFileSync(
  java,
  ['-jar', join(tools, 'lib', 'apksigner.jar'), 'verify', '--verbose', '--print-certs', apk],
  { encoding: 'utf8', windowsHide: true },
);
const certificate = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i.exec(signature)?.[1];
if (!certificate) throw new Error('APK signer certificate missing');
if (certificate.toLowerCase() !== identity.certificateSha256)
  throw new Error('APK signing identity changed; existing users could not upgrade in place');
console.log(
  JSON.stringify(
    {
      apk,
      package: pkg[1],
      version,
      versionCode: code,
      certificate,
      sha256: createHash('sha256')
        .update(await readFile(apk))
        .digest('hex'),
    },
    null,
    2,
  ),
);
