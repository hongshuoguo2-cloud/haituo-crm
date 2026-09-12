import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(projectRoot, ".haituo-release-test-"));
const output = path.join(temporary, "haituo-cloud-windows-v9.8.7-test");
try {
  execFileSync(process.execPath, [path.join(projectRoot, "scripts/prepare-haituo-cloud-release.mjs"), "9.8.7-test", output], { stdio: "pipe" });
  const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.product, "haituo-cloud-windows");
  assert.equal(manifest.version, "9.8.7-test");
  assert.equal(manifest.databaseCompatibility, "backward-compatible");
  assert(manifest.files.length > 100);
  assert(existsSync(path.join(output, "install-haituo-update.ps1")));
  assert(existsSync(path.join(output, "payload/backend/dist/server.js")));
  assert(existsSync(path.join(output, "payload/frontend/dist/index.html")));
  assert(existsSync(path.join(output, "payload/whatsapp-plugin/dist-server/server/index.js")));
  assert(existsSync(path.join(output, "payload/scripts/reset-haituo-admin-password.mjs")));
  assert(existsSync(path.join(output, "payload/deploy/windows/reset-haituo-admin-password.ps1")));
  assert.equal(JSON.parse(readFileSync(path.join(output, "payload/package.json"), "utf8")).version, "9.8.7-test");
  assert.equal(JSON.parse(readFileSync(path.join(output, "payload/frontend/dist/product-config.json"), "utf8")).version, "9.8.7-test");
  for (const entry of manifest.files) {
    assert(!/(^|\/)(?:\.env(?:\.|$)|node_modules|\.git)(?:\/|$)/iu.test(entry.path));
    const file = path.join(output, "payload", ...entry.path.split("/"));
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), entry.sha256);
  }
  assert.deepEqual(readdirSync(output).sort(), ["README-UPDATE.md", "install-haituo-update.ps1", "manifest.json", "payload", "release.json"]);
  console.log(JSON.stringify({ ok: true, files: manifest.files.length, bytes: statSync(path.join(output, "payload/frontend/dist/index.html")).size }));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
