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
 * Frees the cloud copy of a game's V2 save and leaves the files on disk
 * untouched — what the Cloud Save Manager offers, as opposed to
 * `deleteGameCloudSaveData`, which also wipes the local save.
 *
 * The local sync state has to follow the snapshot, or the next sync misreads
 * the deletion:
 * - the anchors describe the snapshot that just went away, and a merge that
 *   still trusts them reads "present locally, gone remotely, unchanged since
 *   the base" as a remote deletion and removes the local file;
 * - tracked custom paths are dropped when reconciliation finds them missing
 *   from the remote snapshot, so they go back to pending and ride along with
 *   the next upload instead of being forgotten.
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
