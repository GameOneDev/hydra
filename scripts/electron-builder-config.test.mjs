import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { parse } from "yaml";

const config = parse(
  readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8")
);

describe("electron-builder.yml", () => {
  // Flipping a fuse rewrites a page of the Electron Framework that the macOS
  // code signature hashes, and Apple Silicon kills the app on first touch of a
  // page whose hash no longer matches. CI has no signing identity, so nothing
  // signs the app after the flip unless the fuse step re-signs it itself.
  test("re-signs the macOS app after flipping fuses", () => {
    assert.equal(config.electronFuses.resetAdHocDarwinSignature, true);
  });

  // electron-builder copies extendInfo into Info.plist with Object.assign, so a
  // YAML list would add the keys "0", "1", ... instead of the usage descriptions.
  test("gives macOS its usage descriptions as plain Info.plist keys", () => {
    const { extendInfo } = config.mac;

    assert.equal(Array.isArray(extendInfo), false);
    assert.deepEqual(Object.keys(extendInfo).sort(), [
      "NSCameraUsageDescription",
      "NSDocumentsFolderUsageDescription",
      "NSDownloadsFolderUsageDescription",
      "NSMicrophoneUsageDescription",
    ]);
  });
});
