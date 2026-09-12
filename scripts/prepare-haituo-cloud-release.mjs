import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(process.argv[2] || "").replace(/^v/u, "");
const outputRoot = path.resolve(process.argv[3] || "");

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error("Usage: node scripts/prepare-haituo-cloud-release.mjs <version> <new-output-directory>");
}
if (!outputRoot || !path.basename(outputRoot).startsWith("haituo-cloud-windows-v")) {
  throw new Error("Output directory name must start with haituo-cloud-windows-v");
}
if (outputRoot === projectRoot || outputRoot.startsWith(projectRoot + path.sep) === false) {
  throw new Error("Output directory must be a new directory inside this project");
}

mkdirSync(outputRoot, { recursive: false });
const payloadRoot = path.join(outputRoot, "payload");
mkdirSync(payloadRoot);

const forbiddenPart = /^(?:\.env(?:\..*)?|node_modules|\.git|\.svn)$/iu;
const forbiddenFile = /(?:^|\/)(?:\.env(?:\.[^/]*)?|node_modules|\.git|\.svn)(?:\/|$)|\.(?:log|pem|key)$/iu;
const runtimeTrees = [
  "backend/dist",
  "frontend/dist",
  "integration-worker/dist",
  "integration-sdk/dist",
  "goodjob-runner/dist",
  "whatsapp-plugin/dist",
  "whatsapp-plugin/dist-server",
  "agent-knowledge",
  "agent-skills"
];
const runtimeFiles = [
  "package.json",
  "package-lock.json",
  "backend/package.json",
  "frontend/package.json",
  "integration-worker/package.json",
  "integration-sdk/package.json",
  "goodjob-runner/package.json",
  "whatsapp-plugin/package.json",
  "whatsapp-plugin/package-lock.json",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "HAITUO.md",
  "scripts/start-haituo-cloud.ps1",
  "scripts/reset-haituo-admin-password.mjs",
  "deploy/windows/check-haituo-update.ps1",
  "deploy/windows/install-haituo-auto-update.ps1",
  "deploy/windows/reset-haituo-admin-password.ps1"
];

const copied = [];
function copyOne(source, relative) {
  const normalized = relative.split(path.sep).join("/");
  if (forbiddenFile.test(normalized) || normalized.split("/").some((part) => forbiddenPart.test(part))) {
    throw new Error(`Forbidden release path: ${normalized}`);
  }
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Release cannot contain symbolic links: ${normalized}`);
  if (!stat.isFile()) throw new Error(`Expected a file: ${normalized}`);
  const destination = path.join(payloadRoot, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  copied.push(normalized);
}
function copyTree(relative) {
  const sourceRoot = path.join(projectRoot, relative);
  const visit = (directory, targetRelative) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const nextRelative = path.join(targetRelative, item.name);
      const source = path.join(directory, item.name);
      if (item.isSymbolicLink()) throw new Error(`Release cannot contain symbolic links: ${nextRelative}`);
      if (item.isDirectory()) visit(source, nextRelative);
      else if (item.isFile()) copyOne(source, nextRelative);
    }
  };
  visit(sourceRoot, relative);
}

for (const tree of runtimeTrees) copyTree(tree);
for (const file of runtimeFiles) copyOne(path.join(projectRoot, file), file);

// The installed package version and login page version follow the release tag.
const packageFile = path.join(payloadRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
packageJson.version = version;
writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + "\n");
const productFile = path.join(payloadRoot, "frontend/dist/product-config.json");
const productConfig = JSON.parse(readFileSync(productFile, "utf8"));
productConfig.version = version;
writeFileSync(productFile, JSON.stringify(productConfig, null, 2) + "\n");

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
const files = copied.sort().map((relative) => ({
  path: relative,
  sha256: sha256(path.join(payloadRoot, ...relative.split("/")))
}));
// Rewritten files keep the same paths but need their final hashes.
for (const relative of ["package.json", "frontend/dist/product-config.json"]) {
  const entry = files.find((item) => item.path === relative);
  entry.sha256 = sha256(path.join(payloadRoot, ...relative.split("/")));
}

writeFileSync(path.join(outputRoot, "manifest.json"), JSON.stringify({
  packageFormatVersion: 1,
  product: "haituo-cloud-windows",
  version,
  databaseCompatibility: "backward-compatible",
  files
}, null, 2) + "\n");
writeFileSync(path.join(outputRoot, "release.json"), JSON.stringify({
  product: "haituo-cloud-windows",
  version,
  builtAt: new Date().toISOString()
}, null, 2) + "\n");
copyFileSync(path.join(projectRoot, "deploy/windows/install-haituo-update.ps1"), path.join(outputRoot, "install-haituo-update.ps1"));
copyFileSync(path.join(projectRoot, "deploy/windows/AUTO-UPDATE.md"), path.join(outputRoot, "README-UPDATE.md"));

console.log(JSON.stringify({ outputRoot, version, payloadFiles: files.length }, null, 2));
