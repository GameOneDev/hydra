import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ManagedArtifact, ManagedSnapshot } from "./cloud-save-manager";
// @ts-ignore The Node ESM test runner requires the source extension.
import * as managerModule from "./cloud-save-manager.ts";

const {
  buildCloudSaveManagerEntries,
  groupCloudSaveManagerEntries,
  sumCloudSaveManagerSizes,
} = managerModule;

const artifact = (
  overrides: Partial<ManagedArtifact> = {}
): ManagedArtifact => ({
  id: "artifact-1",
  artifactLengthInBytes: 100,
  downloadOptionTitle: null,
  createdAt: "2026-01-01T10:00:00Z",
  updatedAt: "2026-01-01T10:00:00Z",
  hostname: "desktop",
  downloadCount: 0,
  isFrozen: false,
  shop: "steam",
  objectId: "440",
  ...overrides,
});

const snapshot = (
  overrides: Partial<ManagedSnapshot> = {}
): ManagedSnapshot => ({
  id: "snapshot-1",
  version: 3,
  createdAt: "2026-01-01T09:00:00Z",
  updatedAt: "2026-01-02T09:00:00Z",
  fileCount: 4,
  totalSizeBytes: 250,
  aggregateHash: "a".repeat(64),
  shop: "steam",
  objectId: "440",
  ...overrides,
});

describe("cloud save manager listing", () => {
  it("counts and sizes both save generations", () => {
    const entries = buildCloudSaveManagerEntries(
      [artifact(), artifact({ id: "artifact-2", artifactLengthInBytes: 50 })],
      [snapshot()]
    );

    assert.equal(entries.length, 3);
    assert.equal(sumCloudSaveManagerSizes(entries), 400);
  });

  it("lists a version the server kept under the save in use", () => {
    const entries = buildCloudSaveManagerEntries(
      [artifact({ id: "backup" })],
      [
        snapshot({
          id: "kept",
          version: 2,
          status: "retained",
          totalSizeBytes: 250,
          updatedAt: "2026-01-01T09:00:00Z",
        }),
        snapshot({ id: "in-use", status: "current" }),
      ]
    );

    assert.equal(sumCloudSaveManagerSizes(entries), 600);

    const [group] = groupCloudSaveManagerEntries(entries, []);

    assert.equal(group.totalSizeInBytes, 600);
    assert.deepEqual(
      group.entries.map((entry) => entry.key),
      ["snapshot:in-use", "snapshot:kept", "artifact:backup"]
    );
    assert.deepEqual(
      group.entries.map(
        (entry) => entry.kind === "snapshot" && entry.isRetained
      ),
      [false, true, false]
    );
  });

  it("groups both generations of a game together, snapshot first", () => {
    const entries = buildCloudSaveManagerEntries(
      [
        artifact({ id: "older", createdAt: "2025-12-01T10:00:00Z" }),
        artifact({ id: "newer", createdAt: "2026-02-01T10:00:00Z" }),
      ],
      [snapshot()]
    );

    const groups = groupCloudSaveManagerEntries(entries, [
      {
        shop: "steam",
        objectId: "440",
        title: "Team Fortress 2",
        iconUrl: "https://cdn.test/icon.png",
      },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "Team Fortress 2");
    assert.equal(groups[0].iconUrl, "https://cdn.test/icon.png");
    assert.equal(groups[0].totalSizeInBytes, 450);
    assert.deepEqual(
      groups[0].entries.map((entry) => entry.key),
      ["snapshot:snapshot-1", "artifact:newer", "artifact:older"]
    );
  });

  it("names a game missing from the library from the server metadata", () => {
    const groups = groupCloudSaveManagerEntries(
      buildCloudSaveManagerEntries(
        [],
        [snapshot({ objectId: "570", gameName: "Dota 2" })]
      ),
      []
    );

    assert.equal(groups[0].title, "Dota 2");
  });

  it("falls back to the object id when nothing names the game", () => {
    const groups = groupCloudSaveManagerEntries(
      buildCloudSaveManagerEntries([], [snapshot({ objectId: "570" })]),
      []
    );

    assert.equal(groups[0].title, "570");
  });

  it("sorts groups by title", () => {
    const groups = groupCloudSaveManagerEntries(
      buildCloudSaveManagerEntries(
        [artifact({ objectId: "570" })],
        [snapshot()]
      ),
      [
        { shop: "steam", objectId: "440", title: "Team Fortress 2" },
        { shop: "steam", objectId: "570", title: "Dota 2" },
      ]
    );

    assert.deepEqual(
      groups.map((group) => group.title),
      ["Dota 2", "Team Fortress 2"]
    );
  });
});
