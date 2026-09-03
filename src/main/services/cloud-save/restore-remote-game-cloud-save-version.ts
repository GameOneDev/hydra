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
 * Puts a version the server kept back in use, then brings this device in line
 * with it.
 *
 * The rollback is the server's to make: promoting the old manifest to a new
 * version leaves every machine — this one included — to notice on its next
 * sync that the remote moved, and restore through the path it already uses
 * for a save uploaded elsewhere. So the local half here is just that sync,
 * run right away instead of at the next game launch; the sync anchor stays
 * put, since it is what tells the merge which files this device left
 * untouched and should therefore take from the cloud.
 *
 * It runs restore-only. A device whose local state the merge can't account
 * for — no anchor for this environment, say — would otherwise upload it and
 * quietly bury the version the user just asked for.
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
    /* The cloud is already rolled back, so a device that can't take it now —
       the game isn't installed here, a sync is running, the save is locked —
       is reported rather than thrown: the next sync picks it up. */
    if (isCloudSaveExecutableMissingError(error)) return "unavailable";
    logger.error("[Cloud Save] Restored version could not be applied locally", {
      shop,
      objectId,
      error,
    });
    return "failed";
  }
};
