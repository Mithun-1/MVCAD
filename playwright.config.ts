import { defineConfig } from '@playwright/test';
const production = process.env.TEST_PRODUCTION === '1';
const port = production ? 4173 : 5173;
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 960 },
    channel: 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer:
    process.env.TEST_EXTERNAL_SERVER === '1'
      ? undefined
      : {
          command: `npm run ${production ? 'preview' : 'dev'} -- --port ${port} --strictPort`,
          url: `http://127.0.0.1:${port}`,
          reuseExistingServer: !process.env.CI,
        },
});
