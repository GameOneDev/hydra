import { HydraApi } from "@main/services";
import { CLOUD_SAVE_V2_FEATURE } from "@main/services/cloud-save/automatic-sync-mode";

import { registerEvent } from "../register-event";

/* Lets the renderer hide the Cloud Save V2 panel when the configured
   self-hosted server has no V2 endpoints, instead of offering a sync that can
   only fail. Always true on official Hydra Cloud. */
registerEvent("getCloudSaveV2Supported", () =>
  Promise.resolve(HydraApi.supportsCloudFeature(CLOUD_SAVE_V2_FEATURE))
);
