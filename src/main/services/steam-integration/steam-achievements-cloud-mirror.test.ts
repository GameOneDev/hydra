import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSteamAchievementMirrorPayload,
  syncedSteamAppIds,
} from "./steam-achievements-cloud-mirror-core.js";

const unlocked = [{ name: "ACH_WIN", unlockTime: 1_700_000_000 }];

describe("syncedSteamAppIds", () => {
  it("keeps the games the run read achievements for", () => {
    assert.deepEqual(
      syncedSteamAppIds(
        new Map([
          ["620", []],
          ["730", [{ name: "ACH_WIN" }]],
        ])
      ),
      ["620", "730"]
    );
  });

  it("drops the games the run skipped", () => {
    assert.deepEqual(
      syncedSteamAppIds(
        new Map<string, unknown[] | undefined>([
          ["620", undefined],
          ["730", []],
        ])
      ),
      ["730"]
    );
  });
});

describe("buildSteamAchievementMirrorPayload", () => {
  it("keys the unlocks by the official game id", () => {
    assert.deepEqual(
      buildSteamAchievementMirrorPayload(
        "620",
        { remoteId: "remote-1", hasActiveSteamImport: true },
        unlocked
      ),
      {
        id: "remote-1",
        objectId: "620",
        shop: "steam",
        hasActiveSteamImport: true,
        achievements: unlocked,
      }
    );
  });

  it("reports a game the Steam integration no longer imports", () => {
    assert.equal(
      buildSteamAchievementMirrorPayload(
        "620",
        { remoteId: "remote-1" },
        unlocked
      )?.hasActiveSteamImport,
      false
    );
  });

  it("skips a game the profile merge has not linked yet", () => {
    assert.equal(
      buildSteamAchievementMirrorPayload("620", { remoteId: null }, unlocked),
      null
    );
    assert.equal(
      buildSteamAchievementMirrorPayload("620", undefined, unlocked),
      null
    );
  });

  it("skips a game with nothing unlocked", () => {
    assert.equal(
      buildSteamAchievementMirrorPayload("620", { remoteId: "remote-1" }, []),
      null
    );
    assert.equal(
      buildSteamAchievementMirrorPayload(
        "620",
        { remoteId: "remote-1" },
        undefined
      ),
      null
    );
  });
});
