import type { ArtworkKind, GameShop } from "@types";

import { artworkKey, type SelfHostedArtworkMap } from "./self-hosted-artwork";

export {
  applySelfHostedArtwork,
  artworkKey,
  type SelfHostedArtworkMap,
} from "./self-hosted-artwork";

interface RemoteArtworkEntry {
  shop: GameShop;
  objectId: string;
  kind: ArtworkKind;
  url: string;
}

/**
 * Custom game images a user has stored on the self-hosted cloud server.
 *
 * The official API only returns these for Hydra Cloud subscribers, so for
 * everyone else on this server they live here instead. Resolves to `null`
 * when there is no self-hosted server or the lookup fails, leaving the
 * official values untouched.
 */
export const fetchSelfHostedArtwork = async (
  userId: string,
  selfHostedCloudUrl?: string | null
): Promise<SelfHostedArtworkMap | null> => {
  if (!selfHostedCloudUrl) return null;

  try {
    const response = await window.electron.hydraApi.get<{
      artwork: RemoteArtworkEntry[];
    }>(`/profile/games/artwork/${userId}`);

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
