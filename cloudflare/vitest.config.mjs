import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./cloudflare/wrangler.jsonc" },
      miniflare: {
        bindings: {
          CRON_SECRET: "test-secret",
          INSULHUB_BASE_URL: "https://insulhub.test",
        },
      },
    }),
  ],
  test: {
    include: ["./**/*.test.js"],
  },
});
