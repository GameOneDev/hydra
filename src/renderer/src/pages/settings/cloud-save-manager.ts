import type { GameArtifact, GameShop, LibraryCloudSaveSnapshot } from "@types";

/** A legacy artifact that knows which game it belongs to. */
export type ManagedArtifact = GameArtifact & {
  shop: GameShop;
  objectId: string;
};

export type ManagedSnapshot = LibraryCloudSaveSnapshot;

/**
 * One stored save, whichever generation produced it: a V2 snapshot (one per
 * game, the save the launcher syncs today) or a legacy V1 backup.
 */
interface CloudSaveManagerEntryBase {
  key: string;
  shop: GameShop;
  objectId: string;
  sizeInBytes: number;
  /**
   * Cloud storage held by older versions of the same save that the server
   * kept, which the entry's own size doesn't cover. Always zero for a legacy
   * backup, and for a server that doesn't retain replaced versions.
   */
  retainedSizeInBytes: number;
  retainedVersionCount: number;
  updatedAt: string;
}

export type CloudSaveManagerEntry =
  | (CloudSaveManagerEntryBase & {
      kind: "snapshot";
      snapshot: ManagedSnapshot;
    })
  | (CloudSaveManagerEntryBase & {
      kind: "artifact";
      artifact: ManagedArtifact;
    });

export interface CloudSaveManagerGroup {
  key: string;
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl: string | null;
  entries: CloudSaveManagerEntry[];
  totalSizeInBytes: number;
}

/** The bits of a library game the manager needs to label a group. */
export interface CloudSaveManagerLibraryGame {
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl?: string | null;
  customIconUrl?: string | null;
}

export const cloudSaveManagerGameKey = (shop: GameShop, objectId: string) =>
  `${shop}:${objectId}`;

export const buildCloudSaveManagerEntries = (
  artifacts: ManagedArtifact[],
  snapshots: ManagedSnapshot[]
): CloudSaveManagerEntry[] => [
  ...snapshots.map<CloudSaveManagerEntry>((snapshot) => ({
    kind: "snapshot",
    key: `snapshot:${snapshot.id}`,
    shop: snapshot.shop,
    objectId: snapshot.objectId,
    sizeInBytes: snapshot.totalSizeBytes,
    retainedSizeInBytes: snapshot.retainedSizeBytes ?? 0,
    retainedVersionCount: snapshot.retainedVersionCount ?? 0,
    updatedAt: snapshot.updatedAt,
    snapshot,
  })),
  ...artifacts.map<CloudSaveManagerEntry>((artifact) => ({
    kind: "artifact",
    key: `artifact:${artifact.id}`,
    shop: artifact.shop,
    objectId: artifact.objectId,
    sizeInBytes: artifact.artifactLengthInBytes,
    retainedSizeInBytes: 0,
    retainedVersionCount: 0,
    updatedAt: artifact.createdAt,
    artifact,
  })),
];

export const sumCloudSaveManagerSizes = (entries: CloudSaveManagerEntry[]) =>
  entries.reduce(
    (total, entry) => total + entry.sizeInBytes + entry.retainedSizeInBytes,
    0
  );

/**
 * Groups every stored save by game, newest first within a game and the V2
 * snapshot — the save actually in use — ahead of the legacy backups.
 */
export const groupCloudSaveManagerEntries = (
  entries: CloudSaveManagerEntry[],
  library: CloudSaveManagerLibraryGame[]
): CloudSaveManagerGroup[] => {
  const byGame = new Map<string, CloudSaveManagerGroup>();

  for (const entry of entries) {
    const key = cloudSaveManagerGameKey(entry.shop, entry.objectId);
    const libraryGame = library.find(
      (game) => game.shop === entry.shop && game.objectId === entry.objectId
    );
    const remoteName =
      entry.kind === "artifact"
        ? entry.artifact.gameName
        : entry.snapshot.gameName;
    const remoteCoverUrl =
      entry.kind === "artifact"
        ? entry.artifact.gameCoverUrl
        : entry.snapshot.gameCoverUrl;

    let group = byGame.get(key);
    if (!group) {
      group = {
        key,
        shop: entry.shop,
        objectId: entry.objectId,
        title: libraryGame?.title ?? remoteName ?? entry.objectId,
        iconUrl:
          libraryGame?.customIconUrl ??
          libraryGame?.iconUrl ??
          remoteCoverUrl ??
          null,
        entries: [],
        totalSizeInBytes: 0,
      };
      byGame.set(key, group);
    }

    group.entries.push(entry);
    group.totalSizeInBytes += entry.sizeInBytes + entry.retainedSizeInBytes;
  }

  for (const group of byGame.values()) {
    group.entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "snapshot" ? -1 : 1;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }

  return [...byGame.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
};
