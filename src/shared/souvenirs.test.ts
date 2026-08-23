import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GameShop, ProfileSouvenir, SteamAchievement } from "@types";

import {
  buildProfileSouvenirVisibilityPath,
  buildProfileSouvenirDeletePath,
  buildSouvenirNotificationTarget,
  buildUserSouvenirLikePath,
  buildUserSouvenirReportPath,
  buildUserSouvenirsPath,
  enrichSouvenirAchievements,
  getPrimarySouvenirAchievement,
  getSouvenirKey,
  getSouvenirVisualVariant,
  isAchievementSouvenirsEnabled,
  findSouvenirByNotificationTarget,
  normalizeProfileSouvenir,
  normalizeSouvenirReportValues,
  shouldShowSouvenirContentWarning,
} from "./souvenirs.js";

describe("souvenir API helpers", () => {
  it("defaults souvenirs off on Linux and on elsewhere", () => {
    assert.equal(isAchievementSouvenirsEnabled(undefined, "linux"), false);
    assert.equal(isAchievementSouvenirsEnabled(undefined, "win32"), true);
    assert.equal(isAchievementSouvenirsEnabled(undefined, "darwin"), true);
  });

  it("preserves an explicit souvenir preference on every platform", () => {
    assert.equal(isAchievementSouvenirsEnabled(true, "linux"), true);
    assert.equal(isAchievementSouvenirsEnabled(false, "win32"), false);
  });

  it("builds an encoded paginated feed path", () => {
    const path = buildUserSouvenirsPath({
      userId: "user/id",
      skip: 24,
      sortBy: "rare",
      language: "pt-BR",
    });

    const [pathname, query] = path.split("?");
    const params = new URLSearchParams(query);

    assert.equal(pathname, "/users/user%2Fid/souvenirs");
    assert.equal(params.get("take"), "24");
    assert.equal(params.get("skip"), "24");
    assert.equal(params.get("sortBy"), "rare");
    assert.equal(params.get("language"), "pt-BR");
    assert.deepEqual(params.getAll("shop"), ["steam", "launchbox"]);
  });

  it("uses the opaque souvenir ID as its stable identity", () => {
    assert.equal(getSouvenirKey("souvenir/id"), "souvenir/id");
  });

  it("encodes every mutable souvenir path segment", () => {
    assert.equal(
      buildUserSouvenirLikePath("owner/id", "souvenir/id"),
      "/users/owner%2Fid/souvenirs/souvenir%2Fid/like"
    );
    assert.equal(
      buildUserSouvenirReportPath("owner/id", "souvenir/id"),
      "/users/owner%2Fid/souvenirs/souvenir%2Fid/report"
    );
    assert.equal(
      buildProfileSouvenirVisibilityPath("souvenir/id"),
      "/profile/souvenirs/souvenir%2Fid/visibility"
    );
    assert.equal(
      buildProfileSouvenirDeletePath("souvenir/id"),
      "/profile/souvenirs/souvenir%2Fid"
    );
  });

  it("builds a notification target for the exact souvenir", () => {
    assert.equal(
      buildSouvenirNotificationTarget("/profile/owner", {
        souvenirKey: "game:id:ACH_WIN",
      }),
      "/profile/owner?tab=souvenirs&souvenir=game%3Aid%3AACH_WIN"
    );
    assert.equal(
      buildSouvenirNotificationTarget("/profile/owner", {}),
      "/profile/owner"
    );
  });

  it("finds notification souvenirs by opaque id or legacy key", () => {
    const grouped = normalizeProfileSouvenir({
      id: "c3d4e5f6",
      imageUrl: null,
      capturedAt: 12,
      primaryAchievementName: "ACH_WIN",
      achievements: [],
      gameId: "game-1",
      objectId: "10",
      shop: "steam",
      gameTitle: "Test Game",
      gameIconUrl: null,
      likeCount: 0,
      likedByMe: false,
    });

    assert.equal(
      findSouvenirByNotificationTarget([grouped], "C3D4E5F6"),
      grouped
    );
    assert.equal(
      findSouvenirByNotificationTarget(
        [grouped],
        `${grouped.gameId}:${grouped.primaryAchievementName}`
      ),
      grouped
    );
  });

  it("trims report descriptions and omits empty descriptions", () => {
    assert.deepEqual(
      normalizeSouvenirReportValues({
        reason: "spam",
        description: "  Repeated promotion  ",
      }),
      { reason: "spam", description: "Repeated promotion" }
    );
    assert.deepEqual(
      normalizeSouvenirReportValues({ reason: "other", description: "   " }),
      { reason: "other" }
    );
  });

  it("uses the platinum design when a souvenir is both rare and platinum", () => {
    assert.equal(
      getSouvenirVisualVariant({ isRare: true, isPlatinum: true }),
      "platinum"
    );
    assert.equal(
      getSouvenirVisualVariant({ isRare: true, isPlatinum: false }),
      "rare"
    );
    assert.equal(
      getSouvenirVisualVariant({ isRare: false, isPlatinum: false }),
      null
    );
  });

  it("warns only for Steam's adult-only sexual content descriptor", () => {
    assert.equal(
      shouldShowSouvenirContentWarning(
        { gameContentDescriptorIds: [3] },
        false
      ),
      true
    );
    assert.equal(
      shouldShowSouvenirContentWarning(
        { gameContentDescriptorIds: [1, 2, 4, 5] },
        false
      ),
      false
    );
    assert.equal(
      shouldShowSouvenirContentWarning({ gameContentDescriptorIds: [] }, false),
      false
    );
    assert.equal(
      shouldShowSouvenirContentWarning(
        { gameContentDescriptorIds: null },
        false
      ),
      false
    );
    assert.equal(shouldShowSouvenirContentWarning({}, false), false);
  });

  it("bypasses souvenir content warnings when the global alert is disabled", () => {
    assert.equal(
      shouldShowSouvenirContentWarning({ gameContentDescriptorIds: [3] }, true),
      false
    );
    assert.equal(shouldShowSouvenirContentWarning({}, true), false);
  });

  it("preserves grouped souvenirs returned by the new feed", () => {
    const grouped = {
      id: "souvenir-1",
      imageUrl: "https://example.com/image.jpeg",
      capturedAt: 12,
      primaryAchievementName: "SECONDARY",
      achievements: [
        {
          name: "PRIMARY",
          displayName: "Primary",
          description: "Primary achievement",
          achievementIcon: null,
          unlockTime: 10,
          points: 10,
          isRare: false,
          isPlatinum: false,
        },
        {
          name: "SECONDARY",
          displayName: "Secondary",
          description: "Secondary achievement",
          achievementIcon: null,
          unlockTime: 11,
          points: 20,
          isRare: true,
          isPlatinum: false,
        },
      ],
      gameId: "game-1",
      objectId: "10",
      shop: "steam" as const,
      gameTitle: "Test Game",
      gameIconUrl: null,
      likeCount: 0,
      likedByMe: false,
    };

    assert.deepEqual(normalizeProfileSouvenir(grouped), grouped);
    assert.equal(
      getPrimarySouvenirAchievement(grouped).name,
      "SECONDARY",
      "the server-selected primary must win even when it is not inferred locally"
    );
  });

  it("finds the server-selected primary case-insensitively", () => {
    const souvenir = normalizeProfileSouvenir({
      id: "souvenir-1",
      imageUrl: null,
      capturedAt: 12,
      primaryAchievementName: "secondary",
      achievements: [
        {
          name: "PRIMARY",
          displayName: "Primary",
          description: "",
          achievementIcon: null,
          unlockTime: 10,
          points: null,
          isRare: false,
          isPlatinum: false,
        },
        {
          name: "SECONDARY",
          displayName: "Secondary",
          description: "",
          achievementIcon: null,
          unlockTime: 11,
          points: null,
          isRare: true,
          isPlatinum: false,
        },
      ],
      gameId: "game-1",
      objectId: "10",
      shop: "steam",
      gameTitle: "Test Game",
      gameIconUrl: null,
      likeCount: 0,
      likedByMe: false,
    });

    assert.equal(getPrimarySouvenirAchievement(souvenir).name, "SECONDARY");
  });

  it("normalizes legacy single-achievement feed items", () => {
    const normalized = normalizeProfileSouvenir({
      name: "LEGACY",
      displayName: "Legacy",
      description: "Legacy achievement",
      imageUrl: null,
      achievementIcon: null,
      unlockTime: 10,
      points: 10,
      isRare: false,
      isPlatinum: false,
      gameUnlockedAchievementCount: 1,
      gameTotalAchievementCount: 10,
      gameId: "game-1",
      objectId: "10",
      shop: "steam",
      gameTitle: "Test Game",
      gameIconUrl: null,
      likeCount: 0,
      likedByMe: false,
    });

    assert.match(normalized.id, /^legacy:/);
    assert.equal(normalized.primaryAchievementName, "LEGACY");
    assert.deepEqual(
      normalized.achievements.map((achievement) => achievement.name),
      ["LEGACY"]
    );
  });
});

describe("souvenir achievement metadata", () => {
  const souvenirOf = (
    id: string,
    names: string[],
    objectId = "440"
  ): ProfileSouvenir => ({
    id,
    imageUrl: `http://server/${id}.jpg`,
    capturedAt: 100,
    primaryAchievementName: names[0],
    achievements: names.map((name) => ({
      name,
      displayName: name,
      description: "",
      achievementIcon: null,
      unlockTime: 100,
      points: null,
      isRare: null,
      isPlatinum: false,
    })),
    visibility: "PUBLIC",
    gameId: "remote-1",
    objectId,
    shop: "steam",
    gameTitle: "Team Fortress 2",
    gameIconUrl: null,
    likeCount: 0,
    likedByMe: false,
  });

  const catalogueEntry = (name: string, points: number): SteamAchievement => ({
    name,
    displayName: `${name} pretty`,
    description: `${name} description`,
    icon: `http://cdn/${name}.jpg`,
    icongray: `http://cdn/${name}-gray.jpg`,
    hidden: false,
    points,
  });

  it("fills names, icons and rarity from the catalogue", async () => {
    const [souvenir] = await enrichSouvenirAchievements(
      [souvenirOf("s1", ["ACH_WIN"])],
      async () => [catalogueEntry("ach_win", 4)]
    );

    const [achievement] = souvenir.achievements;
    assert.equal(achievement.displayName, "ach_win pretty");
    assert.equal(achievement.description, "ach_win description");
    assert.equal(achievement.achievementIcon, "http://cdn/ach_win.jpg");
    assert.equal(achievement.points, 4);
    /* (50 - sqrt(4)) * 2 = 96, well over the 10% rarity threshold. */
    assert.equal(achievement.isRare, false);
  });

  it("marks a low-completion achievement rare", async () => {
    const [souvenir] = await enrichSouvenirAchievements(
      [souvenirOf("s1", ["ACH_WIN"])],
      async () => [catalogueEntry("ACH_WIN", 2401)]
    );

    assert.equal(souvenir.achievements[0].isRare, true);
  });

  it("looks a game up once however many souvenirs it has", async () => {
    const requested: string[] = [];

    await enrichSouvenirAchievements(
      [
        souvenirOf("s1", ["A"]),
        souvenirOf("s2", ["B"]),
        souvenirOf("s3", ["C"], "70"),
      ],
      async (shop: GameShop, objectId: string) => {
        requested.push(`${shop}:${objectId}`);
        return [];
      }
    );

    assert.deepEqual(requested.toSorted(), ["steam:440", "steam:70"]);
  });

  it("asks for nothing when the souvenirs already carry metadata", async () => {
    const souvenir = souvenirOf("s1", ["ACH_WIN"]);
    souvenir.achievements[0].achievementIcon = "http://cdn/official.jpg";
    let calls = 0;

    const [result] = await enrichSouvenirAchievements([souvenir], async () => {
      calls += 1;
      return [];
    });

    assert.equal(calls, 0);
    assert.equal(
      result.achievements[0].achievementIcon,
      "http://cdn/official.jpg"
    );
  });

  it("keeps the raw name when the catalogue can't be read", async () => {
    const [souvenir] = await enrichSouvenirAchievements(
      [souvenirOf("s1", ["ACH_WIN"])],
      async () => {
        throw new Error("offline");
      }
    );

    assert.equal(souvenir.achievements[0].displayName, "ACH_WIN");
    assert.equal(souvenir.achievements[0].achievementIcon, null);
  });

  it("keeps the raw name for an achievement the catalogue doesn't list", async () => {
    const [souvenir] = await enrichSouvenirAchievements(
      [souvenirOf("s1", ["ACH_WIN", "ACH_SECRET"])],
      async () => [catalogueEntry("ACH_WIN", 4)]
    );

    assert.equal(souvenir.achievements[0].displayName, "ACH_WIN pretty");
    assert.equal(souvenir.achievements[1].displayName, "ACH_SECRET");
  });
});
