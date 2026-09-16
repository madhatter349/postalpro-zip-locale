/**
 * Record a failed update run in data/health.json.
 * Invoked from the workflow's `if: failure()` step so the site can surface
 * mirror health instead of silently serving stale data.
 */

import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const HEALTH_FILE = path.join(ROOT, "data", "health.json");

const message =
  process.argv[2] ||
  process.env.ZLP_ERROR ||
  "update workflow failed — see the GitHub Actions run for logs";

let health = {};
try {
  health = JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8"));
} catch {
  // first recorded failure
}

health.status = "error";
health.result = "failed";
health.failed_at = new Date().toISOString();
health.last_error = message;

fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true });
fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2) + "\n");
console.log("[record-failure]", message);
