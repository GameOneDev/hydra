import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AchievementMemoryStore } from "./achievement-memory-store.js";

const entry = (name: string) => ({
  achievements: [],
  unlockedAchievements: [{ name, unlockTime: 1 }],
});

describe("AchievementMemoryStore", () => {
  afterEach(() => AchievementMemoryStore.clear());

  it("isolates achievement state by shop and object id", () => {
    AchievementMemoryStore.set("steam", "10", entry("STEAM_UNLOCK"));
    AchievementMemoryStore.set("launchbox", "10", entry("RA_UNLOCK"));

    assert.deepEqual(
      AchievementMemoryStore.get("steam", "10")?.unlockedAchievements,
      [{ name: "STEAM_UNLOCK", unlockTime: 1 }]
    );
    assert.deepEqual(
      AchievementMemoryStore.get("launchbox", "10")?.unlockedAchievements,
      [{ name: "RA_UNLOCK", unlockTime: 1 }]
    );
  });

  it("drops all achievement state when the authenticated session changes", () => {
    AchievementMemoryStore.set("steam", "10", entry("ACH_UNLOCK"));

    AchievementMemoryStore.clear();

    assert.equal(AchievementMemoryStore.get("steam", "10"), undefined);
  });
});

describe("AchievementMemoryStore baselines", () => {
  afterEach(() => AchievementMemoryStore.clear());

  it("reports no baseline for a game it has never seen", () => {
    assert.equal(AchievementMemoryStore.isHydrated("steam", "10"), false);
  });

  it("does not treat stored achievements as a baseline on their own", () => {
    AchievementMemoryStore.set("steam", "10", entry("ACH_UNLOCK"));

    assert.equal(AchievementMemoryStore.isHydrated("steam", "10"), false);
  });

  it("records a baseline without fabricating an achievement entry", () => {
    AchievementMemoryStore.markHydrated("steam", "10");

    assert.equal(AchievementMemoryStore.isHydrated("steam", "10"), true);
    assert.equal(AchievementMemoryStore.get("steam", "10"), undefined);
  });

  it("keeps baselines isolated by shop and object id", () => {
    AchievementMemoryStore.markHydrated("steam", "10");

    assert.equal(AchievementMemoryStore.isHydrated("launchbox", "10"), false);
    assert.equal(AchievementMemoryStore.isHydrated("steam", "11"), false);
  });

  it("drops baselines when the authenticated session changes", () => {
    AchievementMemoryStore.set("steam", "10", entry("ACH_UNLOCK"));
    AchievementMemoryStore.markHydrated("steam", "10");

    AchievementMemoryStore.clear();

    assert.equal(AchievementMemoryStore.isHydrated("steam", "10"), false);
  });

  it("clears baselines without discarding known unlocks", () => {
    AchievementMemoryStore.set("steam", "10", entry("ACH_UNLOCK"));
    AchievementMemoryStore.markHydrated("steam", "10");

    AchievementMemoryStore.clearHydration();

    assert.equal(AchievementMemoryStore.isHydrated("steam", "10"), false);
    assert.deepEqual(
      AchievementMemoryStore.get("steam", "10")?.unlockedAchievements,
      [{ name: "ACH_UNLOCK", unlockTime: 1 }]
    );
  });
});
