// The commit a static page was built from, read once at build time: Vercel
// and GitHub Actions expose it in the environment; a local build asks git.
// Null when none is available — the page then shows no hash rather than a
// wrong one.
import { execSync } from "node:child_process";

export const REPO = "ewyluda/macrogauge";

export function buildCommit(): string | null {
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (env && /^[0-9a-f]{40}$/i.test(env)) return env;
  try {
    const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
