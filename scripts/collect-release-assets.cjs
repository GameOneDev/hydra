const fs = require("node:fs");
const path = require("node:path");

const artifactsDir = process.argv[2] || "artifacts";
const outDir = process.argv[3] || "release-assets";

fs.mkdirSync(outDir, { recursive: true });

// The mac arm64 and x64 builds each produce a latest-mac.yml listing only
// their own files; electron-updater expects a single manifest with both
const mergeLatestMac = (existingPath, incomingPath) => {
  const yaml = require("js-yaml");
  const existing = yaml.load(fs.readFileSync(existingPath, "utf8"));
  const incoming = yaml.load(fs.readFileSync(incomingPath, "utf8"));

  const urls = new Set(existing.files.map((file) => file.url));
  for (const file of incoming.files) {
    if (!urls.has(file.url)) existing.files.push(file);
  }

  fs.writeFileSync(existingPath, yaml.dump(existing, { lineWidth: -1 }));
};

for (const artifact of fs.readdirSync(artifactsDir)) {
  const artifactPath = path.join(artifactsDir, artifact);
  if (!fs.statSync(artifactPath).isDirectory()) continue;

  for (const file of fs.readdirSync(artifactPath)) {
    // Diagnostic dumps of the electron-builder config; kept as CI
    // artifacts but not worth shipping on the release
    if (file.startsWith("builder-debug")) continue;

    const src = path.join(artifactPath, file);
    if (fs.statSync(src).isDirectory()) continue;

    const dest = path.join(outDir, file);

    if (fs.existsSync(dest)) {
      if (file === "latest-mac.yml") {
        console.log(`Merging ${artifact}/latest-mac.yml...`);
        mergeLatestMac(dest, src);
        continue;
      }

      throw new Error(`Duplicate release asset: ${file} (from ${artifact})`);
    }

    fs.copyFileSync(src, dest);
  }
}

console.log(`Release assets:\n${fs.readdirSync(outDir).sort().join("\n")}`);
