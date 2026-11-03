import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEpicAchievementMirrorPayload } from "./epic-achievements-cloud-mirror-core.js";

const snapshot = {
  namespace: "fn",
  catalogItemId: "4fe75bbc5a674f4f9b356b5c90567da5",
  artifactIds: ["Fortnite"],
  name: "Fortnite",
  playTimeInSeconds: 60,
  achievements: [
    {
      externalSetId: "set",
      externalId: "VICTORY_ROYALE",
      unlockTime: "2026-10-01T12:00:00.000Z",
    },
    { externalSetId: "set", externalId: "BROKEN", unlockTime: "not a date" },
  ],
};

describe("buildEpicAchievementMirrorPayload", () => {
  it("files Epic unlocks under the official game id, in milliseconds", () => {
    assert.deepEqual(
      buildEpicAchievementMirrorPayload(snapshot, { remoteId: "remote-1" }),
      {
        id: "remote-1",
        objectId: "fn:4fe75bbc5a674f4f9b356b5c90567da5",
        shop: "epic",
        achievements: [
          {
            name: "VICTORY_ROYALE",
            unlockTime: Date.parse("2026-10-01T12:00:00.000Z"),
          },
        ],
      }
    );
  });

  it("waits for a game the merge hasn't linked yet", () => {
    assert.equal(
      buildEpicAchievementMirrorPayload(snapshot, { remoteId: null }),
      null
    );
    assert.equal(buildEpicAchievementMirrorPayload(snapshot, undefined), null);
  });

  it("sends nothing for a game without readable unlocks", () => {
    for (const achievements of [null, [], [snapshot.achievements[1]]])
      assert.equal(
        buildEpicAchievementMirrorPayload(
          { ...snapshot, achievements },
          { remoteId: "remote-1" }
        ),
        null
      );
  });
});
