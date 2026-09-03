import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Badge,
  Button,
  CheckboxField,
  ConfirmationModal,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import {
  useAppSelector,
  useDate,
  useFormat,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { GameArtifact, LibraryCloudSaveSnapshot } from "@types";
import {
  ClockIcon,
  DeviceDesktopIcon,
  FileIcon,
  PinIcon,
  SyncIcon,
  TrashIcon,
  VersionsIcon,
} from "@primer/octicons-react";

import { getCloudSaveVisibility } from "../game-details/cloud-save-visibility";

import {
  buildCloudSaveManagerEntries,
  groupCloudSaveManagerEntries,
  sumCloudSaveManagerSizes,
  type CloudSaveManagerEntry,
  type ManagedArtifact,
  type ManagedSnapshot,
} from "./cloud-save-manager";

import "./settings-cloud-saves.scss";

const CONCURRENT_ARTIFACT_REQUESTS = 6;

export function SettingsContextCloudSaves() {
  const { t } = useTranslation("settings");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { updateUserPreferences } = useContext(settingsContext);
  const { formatDateTime, formatDate } = useDate();
  const { formatNumber } = useFormat();
  const { showSuccessToast, showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const { library } = useLibrary();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [enableCloudSavesByDefault, setEnableCloudSavesByDefault] =
    useState(false);
  const [artifacts, setArtifacts] = useState<ManagedArtifact[]>([]);
  const [snapshots, setSnapshots] = useState<ManagedSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [entryToDelete, setEntryToDelete] =
    useState<CloudSaveManagerEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);

  useEffect(() => {
    setEnableCloudSavesByDefault(
      userPreferences?.enableCloudSavesByDefault ?? false
    );
  }, [userPreferences]);

  const handleToggleDefault = () => {
    const value = !enableCloudSavesByDefault;
    setEnableCloudSavesByDefault(value);
    updateUserPreferences({ enableCloudSavesByDefault: value });
  };

  const syncableGames = useMemo(
    () => library.filter((game) => game.shop !== "custom"),
    [library]
  );

  /* Only these shops ever hold a V2 snapshot, so the per-game fallback below
     doesn't ask about the rest. */
  const cloudSaveV2Games = useMemo(
    () =>
      syncableGames.filter(
        (game) => getCloudSaveVisibility(game.shop).settings.showV2
      ),
    [syncableGames]
  );

  const fetchAllArtifacts = useCallback(async (): Promise<
    ManagedArtifact[]
  > => {
    /* One request when the server tags each artifact with its game
       (self-hosted cloud server). This also lists saves of games no longer
       in the library. */
    try {
      const results = await window.electron.hydraApi.get<GameArtifact[]>(
        "/profile/games/artifacts",
        { needsSubscription: true }
      );

      if (
        results.length > 0 &&
        results.every((artifact) => artifact.shop && artifact.objectId)
      ) {
        return results as ManagedArtifact[];
      }
    } catch {
      /* Fall through to the per-game requests below. */
    }

    /* The official API only answers per game, so query each library game. */
    const collected: ManagedArtifact[] = [];

    for (
      let i = 0;
      i < syncableGames.length;
      i += CONCURRENT_ARTIFACT_REQUESTS
    ) {
      const batch = syncableGames.slice(i, i + CONCURRENT_ARTIFACT_REQUESTS);

      const responses = await Promise.all(
        batch.map((game) => {
          const params = new URLSearchParams({
            objectId: game.objectId,
            shop: game.shop,
          });

          return window.electron.hydraApi
            .get<GameArtifact[]>(
              `/profile/games/artifacts?${params.toString()}`,
              { needsSubscription: true }
            )
            .then((items) =>
              items.map((item) => ({
                ...item,
                shop: game.shop,
                objectId: game.objectId,
              }))
            )
            .catch(() => [] as ManagedArtifact[]);
        })
      );

      collected.push(...responses.flat());
    }

    return collected;
  }, [syncableGames]);

  const fetchAllSnapshots = useCallback(async (): Promise<
    ManagedSnapshot[]
  > => {
    if (!(await window.electron.getCloudSaveV2Supported())) return [];

    /* Same shape as the artifacts listing: one request against a server that
       can list every snapshot, per-game requests against one that can't. */
    try {
      const results = await window.electron.hydraApi.get<
        LibraryCloudSaveSnapshot[]
      >("/profile/cloud-saves/all-snapshots", { needsSubscription: true });

      if (
        results.length > 0 &&
        results.every((snapshot) => snapshot.shop && snapshot.objectId)
      ) {
        return results;
      }
    } catch {
      /* Fall through to the per-game requests below. */
    }

    const collected: ManagedSnapshot[] = [];

    for (
      let i = 0;
      i < cloudSaveV2Games.length;
      i += CONCURRENT_ARTIFACT_REQUESTS
    ) {
      const batch = cloudSaveV2Games.slice(i, i + CONCURRENT_ARTIFACT_REQUESTS);

      const responses = await Promise.all(
        batch.map((game) => {
          const params = new URLSearchParams({
            objectId: game.objectId,
            shop: game.shop,
          });

          return window.electron.hydraApi
            .get<LibraryCloudSaveSnapshot[]>(
              `/profile/cloud-saves/snapshots?${params.toString()}`,
              { needsSubscription: true }
            )
            .then((items) =>
              items.map((item) => ({
                ...item,
                shop: game.shop,
                objectId: game.objectId,
              }))
            )
            .catch(() => [] as ManagedSnapshot[]);
        })
      );

      collected.push(...responses.flat());
    }

    return collected;
  }, [cloudSaveV2Games]);

  const refreshCloudSaves = useCallback(async () => {
    setLoading(true);
    try {
      const [nextArtifacts, nextSnapshots] = await Promise.all([
        fetchAllArtifacts(),
        fetchAllSnapshots(),
      ]);
      setArtifacts(nextArtifacts);
      setSnapshots(nextSnapshots);
    } finally {
      setLoading(false);
    }
  }, [fetchAllArtifacts, fetchAllSnapshots]);

  useEffect(() => {
    if (hasActiveSubscription) {
      refreshCloudSaves();
    }
  }, [hasActiveSubscription, refreshCloudSaves]);

  const entries = useMemo(
    () => buildCloudSaveManagerEntries(artifacts, snapshots),
    [artifacts, snapshots]
  );

  const groups = useMemo(
    () => groupCloudSaveManagerEntries(entries, library),
    [entries, library]
  );

  const totalSizeInBytes = useMemo(
    () => sumCloudSaveManagerSizes(entries),
    [entries]
  );

  const deletesSnapshot = entryToDelete?.kind === "snapshot";
  const deletesRetainedVersion = deletesSnapshot && entryToDelete.isRetained;
  const deleteTitle = deletesRetainedVersion
    ? t("delete_kept_version")
    : deletesSnapshot
      ? t("delete_cloud_save")
      : t("delete_backup");

  const handleDeleteEntry = async () => {
    if (!entryToDelete) return;

    setDeletingEntry(true);
    try {
      if (entryToDelete.kind === "artifact") {
        await window.electron.hydraApi.delete(
          `/profile/games/artifacts/${entryToDelete.artifact.id}`
        );
        setArtifacts((prev) =>
          prev.filter((artifact) => artifact.id !== entryToDelete.artifact.id)
        );
      } else {
        /* A kept version has no local sync state pointing at it, so it goes
           straight to the API; the save in use needs the main process to drop
           that state along with it. */
        if (entryToDelete.isRetained) {
          await window.electron.hydraApi.delete(
            `/profile/cloud-saves/snapshots/${entryToDelete.snapshot.id}`
          );
        } else {
          await window.electron.deleteRemoteGameCloudSaveSnapshots(
            entryToDelete.objectId,
            entryToDelete.shop
          );
        }
        setSnapshots((prev) =>
          prev.filter((snapshot) => snapshot.id !== entryToDelete.snapshot.id)
        );
      }
      showSuccessToast(
        deletesRetainedVersion
          ? t("kept_version_deleted")
          : deletesSnapshot
            ? t("cloud_save_deleted")
            : t("backup_deleted")
      );
    } catch (_err) {
      showErrorToast(
        deletesRetainedVersion
          ? t("kept_version_deletion_failed")
          : deletesSnapshot
            ? t("cloud_save_deletion_failed")
            : t("backup_deletion_failed")
      );
    } finally {
      setDeletingEntry(false);
      setEntryToDelete(null);
    }
  };

  const renderEntry = (entry: CloudSaveManagerEntry) => {
    if (entry.kind === "snapshot") {
      const { snapshot } = entry;

      return (
        <li
          key={entry.key}
          className={
            entry.isRetained
              ? "settings-cloud-saves__artifact settings-cloud-saves__artifact--kept"
              : "settings-cloud-saves__artifact"
          }
        >
          <div className="settings-cloud-saves__artifact-info">
            <div className="settings-cloud-saves__artifact-title">
              <span>
                {entry.isRetained
                  ? t("cloud_save_v2_retained_entry", {
                      version: snapshot.version,
                    })
                  : t("cloud_save_v2_entry")}
              </span>
              <Badge>
                {entry.isRetained ? (
                  <>
                    <VersionsIcon size={12} /> {t("cloud_save_v2_kept_badge")}
                  </>
                ) : (
                  t("cloud_save_v2_badge")
                )}
              </Badge>
            </div>

            <div className="settings-cloud-saves__artifact-meta">
              <span>{formatBytes(snapshot.totalSizeBytes)}</span>
              <span>
                <FileIcon size={14} />
                {t("cloud_save_v2_file_count", {
                  count: snapshot.fileCount,
                })}
              </span>
              {snapshot.hostname && (
                <span>
                  <DeviceDesktopIcon size={14} />
                  {snapshot.hostname}
                </span>
              )}
              <span>
                <ClockIcon size={14} />
                {formatDateTime(snapshot.updatedAt)}
              </span>
            </div>
          </div>

          <Button
            type="button"
            theme="outline"
            onClick={() => setEntryToDelete(entry)}
            disabled={deletingEntry}
          >
            <TrashIcon />
            {entry.isRetained
              ? t("delete_kept_version")
              : t("delete_cloud_save")}
          </Button>
        </li>
      );
    }

    const { artifact } = entry;

    return (
      <li key={entry.key} className="settings-cloud-saves__artifact">
        <div className="settings-cloud-saves__artifact-info">
          <div className="settings-cloud-saves__artifact-title">
            <span>
              {artifact.label ??
                t("backup_from", {
                  date: formatDate(artifact.createdAt),
                })}
            </span>
            <Badge>{t("legacy_backup_badge")}</Badge>
            {artifact.isFrozen && (
              <Badge>
                <PinIcon size={12} /> {t("frozen_backup")}
              </Badge>
            )}
          </div>

          <div className="settings-cloud-saves__artifact-meta">
            <span>{formatBytes(artifact.artifactLengthInBytes)}</span>
            <span>
              <DeviceDesktopIcon size={14} />
              {artifact.hostname}
            </span>
            <span>
              <ClockIcon size={14} />
              {formatDateTime(artifact.createdAt)}
            </span>
          </div>
        </div>

        <Button
          type="button"
          theme="outline"
          onClick={() => setEntryToDelete(entry)}
          disabled={deletingEntry || artifact.isFrozen}
          tooltip={
            artifact.isFrozen ? t("cannot_delete_frozen_backup") : undefined
          }
        >
          <TrashIcon />
          {t("delete_backup")}
        </Button>
      </li>
    );
  };

  return (
    <div className="settings-context-panel">
      <ConfirmationModal
        visible={!!entryToDelete}
        title={deleteTitle}
        descriptionText={
          deletesRetainedVersion
            ? t("delete_kept_version_confirmation")
            : deletesSnapshot
              ? t("delete_cloud_save_confirmation")
              : t("delete_backup_confirmation")
        }
        confirmButtonLabel={deleteTitle}
        cancelButtonLabel={t("cancel_delete_backup")}
        buttonsIsDisabled={deletingEntry}
        onConfirm={handleDeleteEntry}
        onClose={() => setEntryToDelete(null)}
      />

      <div className="settings-context-panel__group">
        <h3>{t("cloud_saves_defaults")}</h3>

        <CheckboxField
          label={t("enable_cloud_saves_by_default")}
          checked={enableCloudSavesByDefault}
          onChange={handleToggleDefault}
        />
        <small className="settings-cloud-saves__description">
          {t("enable_cloud_saves_by_default_description")}
        </small>
      </div>

      <div className="settings-context-panel__group">
        <div className="settings-cloud-saves__manager-header">
          <div>
            <h3>{t("cloud_save_manager")}</h3>
            <small className="settings-cloud-saves__description">
              {t("cloud_save_manager_description")}
            </small>
          </div>

          {hasActiveSubscription && (
            <Button
              type="button"
              theme="outline"
              onClick={refreshCloudSaves}
              disabled={loading}
            >
              <SyncIcon
                className={
                  loading ? "settings-cloud-saves__sync-icon" : undefined
                }
              />
              {t("refresh_cloud_saves")}
            </Button>
          )}
        </div>

        {!hasActiveSubscription ? (
          <div className="settings-cloud-saves__upgrade">
            <p>{tHydraCloud("hydra_cloud_feature_found")}</p>
            <Button onClick={() => window.electron.openCheckout()}>
              {tHydraCloud("learn_more")}
            </Button>
          </div>
        ) : (
          <>
            {entries.length > 0 && (
              <small className="settings-cloud-saves__summary">
                {t("cloud_saves_summary", {
                  count: entries.length,
                  size: formatBytes(totalSizeInBytes),
                })}
              </small>
            )}

            {loading && entries.length === 0 && (
              <p className="settings-cloud-saves__state">
                {t("loading_cloud_saves")}
              </p>
            )}

            {!loading && entries.length === 0 && (
              <p className="settings-cloud-saves__state">
                {t("no_cloud_saves_found")}
              </p>
            )}

            {groups.map((group) => (
              <div key={group.key} className="settings-cloud-saves__game">
                <div className="settings-cloud-saves__game-header">
                  {group.iconUrl && (
                    <img
                      src={group.iconUrl}
                      alt={group.title}
                      className="settings-cloud-saves__game-icon"
                    />
                  )}
                  <h4>{group.title}</h4>
                  <span className="settings-cloud-saves__game-meta">
                    {formatNumber(group.entries.length)} ·{" "}
                    {formatBytes(group.totalSizeInBytes)}
                  </span>
                </div>

                <ul className="settings-cloud-saves__artifacts">
                  {group.entries.map(renderEntry)}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
