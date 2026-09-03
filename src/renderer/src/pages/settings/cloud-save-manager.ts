import type { GameArtifact, GameShop, LibraryCloudSaveSnapshot } from "@types";

/** A legacy artifact that knows which game it belongs to. */
export type ManagedArtifact = GameArtifact & {
  shop: GameShop;
  objectId: string;
};

export type ManagedSnapshot = LibraryCloudSaveSnapshot;

/**
 * One stored save, whichever generation produced it: the V2 snapshot a game
 * syncs today, a version of it the server kept after a sync replaced it, or a
 * legacy V1 backup.
 */
interface CloudSaveManagerEntryBase {
  key: string;
  shop: GameShop;
  objectId: string;
  sizeInBytes: number;
  updatedAt: string;
}

export type CloudSaveManagerEntry =
  | (CloudSaveManagerEntryBase & {
      kind: "snapshot";
      /** A version the launcher no longer syncs, deletable on its own. */
      isRetained: boolean;
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
    updatedAt: snapshot.updatedAt,
    isRetained: snapshot.status === "retained",
    snapshot,
  })),
  ...artifacts.map<CloudSaveManagerEntry>((artifact) => ({
    kind: "artifact",
    key: `artifact:${artifact.id}`,
    shop: artifact.shop,
    objectId: artifact.objectId,
    sizeInBytes: artifact.artifactLengthInBytes,
    updatedAt: artifact.createdAt,
    artifact,
  })),
];

export const sumCloudSaveManagerSizes = (entries: CloudSaveManagerEntry[]) =>
  entries.reduce((total, entry) => total + entry.sizeInBytes, 0);

/** Where an entry sits within its game: the save in use, then the versions
 *  kept behind it, then the legacy backups. */
const entryRank = (entry: CloudSaveManagerEntry) => {
  if (entry.kind === "artifact") return 2;
  return entry.isRetained ? 1 : 0;
};

/**
 * Groups every stored save by game, ranked as above and newest first within a
 * rank.
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
    group.totalSizeInBytes += entry.sizeInBytes;
  }

  for (const group of byGame.values()) {
    group.entries.sort((left, right) => {
      const rank = entryRank(left) - entryRank(right);
      if (rank !== 0) return rank;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }

  return [...byGame.values()].sort((left, right) =>
    left.title.localeCompare(right.title)
  );
};
