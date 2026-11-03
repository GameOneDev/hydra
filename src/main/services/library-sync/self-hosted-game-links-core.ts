import type { GameShop, LibraryCatalogueMetadata } from "@types";

export type LinkableGame = LibraryCatalogueMetadata & {
  shop: GameShop;
  objectId: string;
};

/** The Steam and Epic games the official catalogue has linked to a title. */
export const buildGameLinks = (games: readonly LinkableGame[]) =>
  games.flatMap((game) =>
    (game.shop === "steam" || game.shop === "epic") && game.canonicalId
      ? [
          {
            shop: game.shop,
            objectId: game.objectId,
            canonicalId: game.canonicalId,
          },
        ]
      : []
  );
