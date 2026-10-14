import { app } from 'electron';

// Packaged Electron ignores Playwright's external --require loader. Only an
// explicitly isolated package test waits for Chromium attachment before creating
// windows. Ordinary startup and the development loader are unchanged.
export const testStartGate =
  app.isPackaged && process.env.CSHELL_TEST_DATA && process.env.CSHELL_TEST_START_GATE === '1'
    ? new Promise<void>((resolve) => {
        const globals = globalThis as typeof globalThis & {
          __playwright_run?: () => void;
          __cshellPackagedTestAttached?: boolean;
        };
        const timer = setTimeout(() => {
          delete globals.__playwright_run;
          console.error('Packaged test did not attach Chromium within 30 seconds');
          app.exit(1);
        }, 30_000);
        globals.__playwright_run = () => {
          clearTimeout(timer);
          delete globals.__playwright_run;
          globals.__cshellPackagedTestAttached = true;
          resolve();
        };
      })
    : Promise.resolve();
