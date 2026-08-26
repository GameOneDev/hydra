import type { GameShop, SteamAchievement, UnlockedAchievement } from "@types";

type AchievementMemoryEntry = {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  language?: string;
  catalogueValidator?: string;
};

const entries = new Map<string, AchievementMemoryEntry>();

/* Games whose already-unlocked achievements have been established for the
   current session. Achievements are only "new" relative to such a baseline:
   this store is session-scoped, so it is empty at launch and after every
   sign-in/sign-out/401 that clears it, and diffing against an empty baseline
   classifies a game's whole unlock history as freshly unlocked. Kept apart
   from `entries` so marking a baseline never fabricates an achievement entry
   — consumers fall back to the server-known unlocked count when a game has
   no entry, and a phantom empty one would read as "zero unlocked". */
const hydratedGames = new Set<string>();

const gameKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

export const AchievementMemoryStore = {
  get(shop: GameShop, objectId: string) {
    return entries.get(gameKey(shop, objectId));
  },

  set(
    shop: GameShop,
    objectId: string,
    achievementEntry: AchievementMemoryEntry
  ) {
    entries.set(gameKey(shop, objectId), achievementEntry);
  },

  isHydrated(shop: GameShop, objectId: string) {
    return hydratedGames.has(gameKey(shop, objectId));
  },

  markHydrated(shop: GameShop, objectId: string) {
    hydratedGames.add(gameKey(shop, objectId));
  },

  /* Drops the baselines without touching what is known to be unlocked, so the
     next merge per game re-establishes one silently while the library keeps
     showing accurate unlocked counts in the meantime. */
  clearHydration() {
    hydratedGames.clear();
  },

  all() {
    return entries.entries();
  },

  clear() {
    entries.clear();
    hydratedGames.clear();
  },
};
