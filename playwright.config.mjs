import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
 testDir:'./tests',testMatch:'*.spec.mjs',workers:1,timeout:40000,
 use:{baseURL:'http://127.0.0.1:4177',headless:true,viewport:{width:1512,height:982},launchOptions:{executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)}},
 webServer:{command:'node scripts/dev.mjs',url:'http://127.0.0.1:4177/health',env:{EDITOR_TEST_DB:':memory:'},reuseExistingServer:false,timeout:10000}
});
