// Explicit production profile. Never silently produce unsigned release assets.
// Supply signing credentials through the build environment, not this file.
import { readFileSync } from 'node:fs';
const { build } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default {
  ...build,
  forceCodeSigning: true,
  win: { ...build.win, signExecutable: true },
};
