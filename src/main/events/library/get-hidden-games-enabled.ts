import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("getHiddenGamesEnabled", () =>
  Promise.resolve(HydraApi.supportsHiddenGames())
);
