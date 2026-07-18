import type { ArtworkKind, GameShop, UserGame } from "@types";

interface RemoteArtworkEntry {
  shop: GameShop;
  objectId: string;
  kind: ArtworkKind;
  url: string;
}

export type SelfHostedArtworkMap = Map<
  string,
  Partial<Record<ArtworkKind, string>>
>;

const artworkKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

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

/**
 * Overlays the self-hosted images onto games from the official API. The
 * official values stay as the fallback, so games customized by a real Hydra
 * Cloud subscriber keep the images that API already returned.
 */
export const applySelfHostedArtwork = <T extends UserGame>(
  games: T[],
  artwork: SelfHostedArtworkMap | null
): T[] => {
  if (!artwork?.size) return games;

  return games.map((game) => {
    const custom = artwork.get(artworkKey(game.shop, game.objectId));
    if (!custom) return game;

    return {
      ...game,
      customLibraryImageUrl: custom.grids ?? game.customLibraryImageUrl,
      customLibraryHeroImageUrl:
        custom.heroes ?? game.customLibraryHeroImageUrl,
      customLogoImageUrl: custom.logos ?? game.customLogoImageUrl,
      customIconUrl: custom.icons ?? game.customIconUrl,
    };
  });
};
