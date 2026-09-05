export const buildRestoreCloudSaveVersionUrl = (snapshotId: string) =>
  `/profile/cloud-saves/snapshots/${encodeURIComponent(snapshotId)}/restore`;

/** The promoted snapshot, as the manager needs to identify it afterwards. */
export const readRestoredCloudSaveVersion = (value: unknown) => {
  const snapshot = (value ?? {}) as Record<string, unknown>;
  if (
    typeof snapshot.snapshotId !== "string" ||
    !snapshot.snapshotId ||
    typeof snapshot.version !== "number" ||
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1
  ) {
    throw new Error("cloud_save_restore_version_invalid_response");
  }
  return { snapshotId: snapshot.snapshotId, version: snapshot.version };
};
