import type { ArtworkKind, GameShop } from "@types";
import { HydraApi } from "../hydra-api";

interface RemoteArtworkEntry {
  shop: GameShop;
  objectId: string;
  kind: ArtworkKind;
  source: "upload" | "steamgriddb";
  url: string;
  updatedAt: string;
}

/** Custom images one user has saved on the self-hosted server, by game. */
export type SelfHostedArtworkMap = Map<
  string,
  Partial<Record<ArtworkKind, string>>
>;

export const artworkKey = (shop: GameShop, objectId: string) =>
  `${shop}:${objectId}`;

/**
 * Custom game images stored on the self-hosted cloud server.
 *
 * The official API only syncs these for Hydra Cloud subscribers, so for
 * everyone else they live here instead. Pass a `userId` to read someone
 * else's — the server exposes them to any of its users, matching Hydra
 * Cloud, where custom images are visible to whoever views the profile.
 *
 * Returns `null` when there is no self-hosted server or the lookup fails, so
 * callers fall back to whatever the official API gave them.
 */
export const fetchSelfHostedArtwork = async (
  userId?: string
): Promise<SelfHostedArtworkMap | null> => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return null;

  try {
    const response = await HydraApi.get<{ artwork: RemoteArtworkEntry[] }>(
      userId ? `/profile/games/artwork/${userId}` : "/profile/games/artwork"
    );

    const map: SelfHostedArtworkMap = new Map();

    for (const entry of response?.artwork ?? []) {
      const key = artworkKey(entry.shop, entry.objectId);
      map.set(key, { ...map.get(key), [entry.kind]: entry.url });
    }

    return map;
  } catch {
    return null;
  }
};
