import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("getHiddenGamesSupported", () =>
  Promise.resolve(HydraApi.supportsCloudFeature("hidden-games"))
);
