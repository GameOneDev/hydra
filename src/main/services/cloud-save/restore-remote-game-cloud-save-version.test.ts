import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildRestoreCloudSaveVersionUrl,
  readRestoredCloudSaveVersion,
} from "./restore-remote-game-cloud-save-version-policy.ts";

describe("restore a kept cloud save version", () => {
  it("builds an encoded request URL for the snapshot", () => {
    assert.equal(
      buildRestoreCloudSaveVersionUrl("snapshot id/with spaces"),
      "/profile/cloud-saves/snapshots/snapshot%20id%2Fwith%20spaces/restore"
    );
  });

  it("reads the promoted version out of the response", () => {
    assert.deepEqual(
      readRestoredCloudSaveVersion({
        snapshotId: "kept",
        version: 4,
        fileCount: 3,
        totalSizeBytes: 42,
        aggregateHash: "a".repeat(64),
      }),
      { snapshotId: "kept", version: 4 }
    );
  });

  it("refuses a response that doesn't say what was promoted", () => {
    for (const response of [
      null,
      {},
      { snapshotId: "kept" },
      { snapshotId: "", version: 4 },
      { snapshotId: "kept", version: 0 },
      { snapshotId: "kept", version: 1.5 },
      { snapshotId: "kept", version: "4" },
    ]) {
      assert.throws(
        () => readRestoredCloudSaveVersion(response),
        /cloud_save_restore_version_invalid_response/
      );
    }
  });
});
