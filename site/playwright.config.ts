import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // A CI-only failure is otherwise undiagnosable: ci.yml uploads test-results/
  // (trace.zip + error-context.md) when the site job fails.
  use: { baseURL: "http://localhost:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npx serve -l 4173 out",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
