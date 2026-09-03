import type { GameShop } from "@types";

interface DeleteGameCloudSaveDataDependencies {
  beginPendingDeletion: () => Promise<"prepared" | "remote-started">;
  markRemoteDeletionStarted: () => Promise<void>;
  clearPendingDeletion: () => Promise<void>;
  runWithLocalDeletionSnapshot: (
    operation: (snapshot: {
      deleteLocalFiles: () => Promise<void>;
      clearLocalState: () => Promise<void>;
    }) => Promise<void>
  ) => Promise<void>;
  assertGameNotRunning: () => void;
  deleteRemoteSnapshots: () => Promise<void>;
}

export const buildDeleteGameCloudSaveSnapshotsUrl = (
  objectId: string,
  shop: GameShop
) => {
  const params = new URLSearchParams({ objectId, shop });
  return `/profile/cloud-saves/snapshots?${params.toString()}`;
};

interface DeleteRemoteGameCloudSaveSnapshotsDependencies {
  deleteRemoteSnapshots: () => Promise<void>;
  markCustomPathsPending: () => Promise<void>;
  clearSyncAnchors: () => Promise<void>;
}

/**
 * Remote-only deletion: the cloud copy goes, the local save stays.
 *
 * The local bookkeeping runs after the remote call, and only if it succeeded —
 * dropping the anchors while the snapshot is still there would make the next
 * sync re-upload from scratch for nothing.
 */
export const executeDeleteRemoteGameCloudSaveSnapshots = async ({
  deleteRemoteSnapshots,
  markCustomPathsPending,
  clearSyncAnchors,
}: DeleteRemoteGameCloudSaveSnapshotsDependencies) => {
  await deleteRemoteSnapshots();
  await markCustomPathsPending();
  await clearSyncAnchors();
};

export const executeDeleteGameCloudSaveData = async ({
  beginPendingDeletion,
  markRemoteDeletionStarted,
  clearPendingDeletion,
  runWithLocalDeletionSnapshot,
  assertGameNotRunning,
  deleteRemoteSnapshots,
}: DeleteGameCloudSaveDataDependencies) => {
  let pendingPhase = await beginPendingDeletion();

  const advanceToRemoteStarted = async () => {
    pendingPhase = "remote-started";
    await markRemoteDeletionStarted();
  };

  const rollbackIsSafe = () => pendingPhase === "prepared";

  try {
    await runWithLocalDeletionSnapshot(
      async ({ deleteLocalFiles, clearLocalState }) => {
        assertGameNotRunning();
        await advanceToRemoteStarted();
        await deleteRemoteSnapshots();
        assertGameNotRunning();
        await deleteLocalFiles();
        await clearLocalState();
        await clearPendingDeletion();
      }
    );
  } catch (error) {
    if (rollbackIsSafe()) {
      try {
        await clearPendingDeletion();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "cloud_save_delete_rollback_failed"
        );
      }
    }
    throw error;
  }
};
