import { ACHIEVEMENT_SOUVENIRS_FEATURE, HydraApi } from "@main/services";

import { registerEvent } from "../register-event";

/* Lets the profile say "this server doesn't do souvenirs" instead of blaming a
   missing subscription, and stops it offering a capture that can't be stored.
   Always true on official Hydra Cloud, which implements whatever the launcher
   ships. */
registerEvent("getAchievementSouvenirsSupported", () =>
  Promise.resolve(HydraApi.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE))
);
