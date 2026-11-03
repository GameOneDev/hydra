import type { Game, GameShop } from "@types";

export interface HiddenGameEntry {
  shop: GameShop;
  objectId: string;
}

export type VisibilityGame = Pick<Game, "shop" | "objectId"> &
  Partial<Pick<Game, "isConcealed" | "isHiddenFromOthers">>;

const entryKey = ({ shop, objectId }: HiddenGameEntry) => `${shop}:${objectId}`;

/** Whether the self-hosted server should keep this game off what other members see. */
export const isHiddenOnSelfHostedServer = (
  game: Pick<VisibilityGame, "isConcealed" | "isHiddenFromOthers">
) => Boolean(game.isHiddenFromOthers || game.isConcealed);

/**
 * What to change on the server so its list matches upstream's visibility.
 *
 * `profileGames` is the official profile as the last library merge read it.
 * Only a game the profile itself shows as revealed comes off the list: an
 * entry for a game the profile doesn't have — removed from the library, or
 * hidden by a launcher older than 4.1.6, which took it off the profile — stays
 * hidden, since showing it would be the one mistake that can't be taken back.
 */
export const planHiddenGamesReconcile = (
  serverEntries: HiddenGameEntry[],
  profileGames: VisibilityGame[]
) => {
  const onServer = new Set(serverEntries.map(entryKey));
  const games = profileGames.filter((game) => game.shop !== "custom");

  const hide = games
    .filter(
      (game) =>
        isHiddenOnSelfHostedServer(game) && !onServer.has(entryKey(game))
    )
    .map(({ shop, objectId }) => ({ shop, objectId }));

  const revealed = new Set(
    games.filter((game) => !isHiddenOnSelfHostedServer(game)).map(entryKey)
  );

  const unhide = serverEntries.filter((entry) => revealed.has(entryKey(entry)));

  return { hide, unhide };
};
