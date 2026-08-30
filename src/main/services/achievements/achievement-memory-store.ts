import type { GameShop, SteamAchievement, UnlockedAchievement } from "@types";

type AchievementMemoryEntry = {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  language?: string;
  catalogueValidator?: string;
};

const entries = new Map<string, AchievementMemoryEntry>();

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
