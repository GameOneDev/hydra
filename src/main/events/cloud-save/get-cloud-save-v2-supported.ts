import { HydraApi } from "@main/services";
import { getCloudSaveV2FeaturesForShop } from "@main/services/cloud-save/automatic-sync-mode";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

/* Lets the renderer hide the Cloud Save V2 panel when the configured
   self-hosted server has no V2 endpoints — or, for an Epic game, a server that
   predates Epic support, or, for a recompilation, one that cannot keep its
   saves apart from the plain game's — instead of offering a sync that can only
   fail or do harm. Always true on official Hydra Cloud. */
registerEvent(
  "getCloudSaveV2Supported",
  (_event, shop?: GameShop | null, objectId?: string | null) =>
    Promise.resolve(
      getCloudSaveV2FeaturesForShop(shop, objectId).every((feature) =>
        HydraApi.supportsCloudFeature(feature)
      )
    )
);
