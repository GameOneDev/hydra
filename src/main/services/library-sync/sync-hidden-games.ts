import { gamesSublevel, gamesShopAssetsSublevel } from "@main/level";
import { getSteamAppDetails } from "../steam";
import { HydraApi } from "../hydra-api";

export const syncHiddenGames = async () => {
  if (!HydraApi.isLoggedIn() || !HydraApi.isSelfHostedCloudEnabled()) return;

  console.log("FETCHING HIDDEN GAMES");
  const hiddenOnServer = await HydraApi.get<
    Array<{ shop: string; objectId: string }>
  >("/profile/hidden-games", undefined, { needsAuth: true }).catch((e) => {
    console.error("FAILED TO FETCH HIDDEN GAMES", e);
    return null;
  });

  if (!hiddenOnServer) return; // Abort sync if fetching fails to avoid unhiding everything mistakenly

  const serverHiddenSet = new Set<string>();

  for (const { shop, objectId } of hiddenOnServer) {
    const key = `${shop}:${objectId}`;
    serverHiddenSet.add(key);

    const localGame = await gamesSublevel.get(key).catch(() => null);

    if (localGame) {
      if (localGame.remoteId) {
        HydraApi.delete(`/profile/games/${localGame.remoteId}`, {
          needsAuth: true,
        }).catch(() => {});
      }

      if (!localGame.isHidden || localGame.remoteId) {
        await gamesSublevel.put(key, {
          ...localGame,
          isHidden: true,
          remoteId: null,
        });
      }
    } else {
      let title = "Hidden Game";
      let coverImageUrl: string | null = null;
      let iconUrl: string | null = null;

      const existingAsset = await gamesShopAssetsSublevel
        .get(key)
        .catch(() => null);
      if (existingAsset && existingAsset.title !== "Hidden Game") {
        title = existingAsset.title;
        coverImageUrl = existingAsset.coverImageUrl || null;
        iconUrl = existingAsset.iconUrl || null;
      } else {
        try {
          if (shop === "steam") {
            coverImageUrl = `https://shared.steamstatic.com/store_item_assets/steam/apps/${objectId}/library_600x900_2x.jpg`;
            const details = await getSteamAppDetails(objectId, "english");
            if (details?.name) title = details.name;
          } else if (shop === "launchbox") {
            const basic = await HydraApi.get<{
              title: string;
              coverImageUrl: string | null;
            }>(`/games/launchbox/${objectId}`, null, {
              needsAuth: false,
            }).catch(() => null);
            if (basic) {
              title = basic.title;
              coverImageUrl = basic.coverImageUrl;
            }
          }
        } catch (err) {
          console.error("FAILED TO FETCH HIDDEN GAME DETAILS", err);
        }
      }

      await gamesSublevel.put(key, {
        shop: shop as any,
        objectId,
        title,
        iconUrl,
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        isDeleted: false,
        isHidden: true,
        remoteId: null,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
      });

      await gamesShopAssetsSublevel.put(key, {
        updatedAt: Date.now(),
        shop: shop as any,
        objectId,
        title,
        coverImageUrl,
        iconUrl,
        libraryHeroImageUrl: null,
        libraryImageUrl: null,
        logoImageUrl: null,
        logoPosition: null,
        downloadSources: [],
      });
    }
  }

  // Unhide local games that are no longer hidden on server
  const entries = await gamesSublevel.iterator().all();
  for (const [key, game] of entries) {
    if (game.isHidden && !serverHiddenSet.has(key)) {
      await gamesSublevel.put(key, { ...game, isHidden: false });
    }
  }
};
