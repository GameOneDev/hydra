import type { ArtworkKind, GameShop, UserGame } from "@types";

/** Custom images one user has saved on the self-hosted server, by game. */
export type SelfHostedArtworkMap = Map<
  string,
  Partial<Record<ArtworkKind, string>>
>;

export const artworkKey = (shop: GameShop, objectId: string) =>
  `${shop}:${objectId}`;

/**
 * Overlays the self-hosted images onto games from the official API. The
 * official values stay as the fallback, so games customized by a real Hydra
 * Cloud subscriber keep the images that API already returned.
 *
 * Kept free of any `window` access so it stays unit-testable on its own.
 */
export const applySelfHostedArtwork = <T extends UserGame>(
  games: T[] | null | undefined,
  artwork: SelfHostedArtworkMap | null
): T[] => {
  /* The profile endpoint types its game lists as always present but omits
     them in some responses, so this must tolerate a missing list rather
     than throw into a caller's catch. */
  if (!Array.isArray(games)) return [];
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
