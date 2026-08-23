import { ACHIEVEMENT_SOUVENIRS_FEATURE, HydraApi } from "@main/services";

import { registerEvent } from "../register-event";

/* Lets the profile say "this server doesn't do souvenirs" instead of blaming a
   missing subscription. Always true on official Hydra Cloud. */
registerEvent("getAchievementSouvenirsSupported", () =>
  Promise.resolve(HydraApi.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE))
);
