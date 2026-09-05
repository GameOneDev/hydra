import type { GameShop } from "@types";

import { HydraApi } from "../hydra-api";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { markCloudSaveCustomPathsPending } from "./custom-path-store";
import {
  buildDeleteGameCloudSaveSnapshotsUrl,
  executeDeleteRemoteGameCloudSaveSnapshots,
} from "./delete-game-cloud-save-data-policy";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import { clearCloudSaveSyncAnchors } from "./sync-anchor";

/**
 * Frees the cloud copy and leaves the local save alone, unlike
 * `deleteGameCloudSaveData`. The local sync state goes with the snapshot: a
 * stale anchor would make the next sync delete the local files, and custom
 * paths go back to pending so the next upload still carries them.
 */
export const deleteRemoteGameCloudSaveSnapshots = async (
  objectId: string,
  shop: GameShop
) => {
  assertCloudSaveSubscription();

  return cloudSaveOperationGate.runDeletion(
    cloudSaveOperationScopeKey(objectId, shop),
    "delete-remote-game-cloud-save-snapshots",
    () =>
      executeDeleteRemoteGameCloudSaveSnapshots({
        deleteRemoteSnapshots: () =>
          HydraApi.delete<void>(
            buildDeleteGameCloudSaveSnapshotsUrl(objectId, shop),
            {
              needsAuth: true,
              needsSubscription: true,
            }
          ),
        markCustomPathsPending: () =>
          markCloudSaveCustomPathsPending(shop, objectId),
        clearSyncAnchors: () => clearCloudSaveSyncAnchors(shop, objectId),
      })
  );
};
