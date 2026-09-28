import type {
  CloudSaveVersionRestoreLocalOutcome,
  GameShop,
  RestoreCloudSaveVersionResult,
} from "@types";
import { logger } from "@main/services/logger";

import { HydraApi } from "../hydra-api";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { isCloudSaveExecutableMissingError } from "./executable-path-guard";
import {
  buildRestoreCloudSaveVersionUrl,
  readRestoredCloudSaveVersion,
} from "./restore-remote-game-cloud-save-version-policy";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import { syncGameCloudSave } from "./sync-game-cloud-save";

/**
 * Rolls the cloud back to a kept version, then syncs so this device follows
 * instead of waiting for the next launch. The sync is restore-only, or a
 * device the merge can't account for would upload over the restored version.
 * The anchor stays put: it tells the merge what to take from the cloud.
 */
export const restoreRemoteGameCloudSaveVersion = async (
  objectId: string,
  shop: GameShop,
  snapshotId: string
): Promise<RestoreCloudSaveVersionResult> => {
  assertCloudSaveSubscription();

  const restored = await cloudSaveOperationGate.runSync(
    cloudSaveOperationScopeKey(objectId, shop),
    `restore-cloud-save-version:${snapshotId}`,
    () =>
      HydraApi.post<unknown>(
        buildRestoreCloudSaveVersionUrl(snapshotId),
        undefined,
        { needsAuth: true, needsSubscription: true }
      )
  );
  const snapshot = readRestoredCloudSaveVersion(restored);

  return { ...snapshot, local: await applyLocally(objectId, shop) };
};

const applyLocally = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveVersionRestoreLocalOutcome> => {
  try {
    const result = await syncGameCloudSave(objectId, shop, "version-restore");
    return result.finalState === "conflict" ? "conflict" : "applied";
  } catch (error) {
    /* The rollback already happened, so a device that can't take it now is
       reported rather than thrown: the next sync picks it up. */
    if (isCloudSaveExecutableMissingError(error)) return "unavailable";
    logger.error("[Cloud Save] Restored version could not be applied locally", {
      shop,
      objectId,
      error,
    });
    return "failed";
  }
};
