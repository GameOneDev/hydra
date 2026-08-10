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
import type { GameArtifact, GameShop } from "@types";
import {
  ClockIcon,
  DeviceDesktopIcon,
  PinIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import "./settings-cloud-saves.scss";

const CONCURRENT_ARTIFACT_REQUESTS = 6;

type ManagedArtifact = GameArtifact & { shop: GameShop; objectId: string };

interface CloudSaveGroup {
  key: string;
  title: string;
  iconUrl: string | null;
  artifacts: ManagedArtifact[];
  totalSizeInBytes: number;
}

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
  const [loading, setLoading] = useState(false);
  const [artifactToDelete, setArtifactToDelete] =
    useState<ManagedArtifact | null>(null);
  const [deletingArtifact, setDeletingArtifact] = useState(false);

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
    const games = library.filter((game) => game.shop !== "custom");
    const collected: ManagedArtifact[] = [];

    for (let i = 0; i < games.length; i += CONCURRENT_ARTIFACT_REQUESTS) {
      const batch = games.slice(i, i + CONCURRENT_ARTIFACT_REQUESTS);

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
  }, [library]);

  const refreshArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      setArtifacts(await fetchAllArtifacts());
    } finally {
      setLoading(false);
    }
  }, [fetchAllArtifacts]);

  useEffect(() => {
    if (hasActiveSubscription) {
      refreshArtifacts();
    }
  }, [hasActiveSubscription, refreshArtifacts]);

  const groups = useMemo<CloudSaveGroup[]>(() => {
    const byGame = new Map<string, CloudSaveGroup>();

    for (const artifact of artifacts) {
      const key = `${artifact.shop}:${artifact.objectId}`;
      const libraryGame = library.find(
        (game) =>
          game.shop === artifact.shop && game.objectId === artifact.objectId
      );

      let group = byGame.get(key);
      if (!group) {
        group = {
          key,
          title: libraryGame?.title ?? artifact.gameName ?? artifact.objectId,
          iconUrl:
            libraryGame?.customIconUrl ??
            libraryGame?.iconUrl ??
            artifact.gameCoverUrl ??
            null,
          artifacts: [],
          totalSizeInBytes: 0,
        };
        byGame.set(key, group);
      }

      group.artifacts.push(artifact);
      group.totalSizeInBytes += artifact.artifactLengthInBytes;
    }

    return [...byGame.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [artifacts, library]);

  const totalSizeInBytes = useMemo(
    () =>
      artifacts.reduce(
        (total, artifact) => total + artifact.artifactLengthInBytes,
        0
      ),
    [artifacts]
  );

  const handleDeleteArtifact = async () => {
    if (!artifactToDelete) return;

    setDeletingArtifact(true);
    try {
      await window.electron.hydraApi.delete(
        `/profile/games/artifacts/${artifactToDelete.id}`
      );
      setArtifacts((prev) =>
        prev.filter((artifact) => artifact.id !== artifactToDelete.id)
      );
      showSuccessToast(t("backup_deleted"));
    } catch (_err) {
      showErrorToast(t("backup_deletion_failed"));
    } finally {
      setDeletingArtifact(false);
      setArtifactToDelete(null);
    }
  };

  return (
    <div className="settings-context-panel">
      <ConfirmationModal
        visible={!!artifactToDelete}
        title={t("delete_backup")}
        descriptionText={t("delete_backup_confirmation")}
        confirmButtonLabel={t("delete_backup")}
        cancelButtonLabel={t("cancel_delete_backup")}
        buttonsIsDisabled={deletingArtifact}
        onConfirm={handleDeleteArtifact}
        onClose={() => setArtifactToDelete(null)}
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
              onClick={refreshArtifacts}
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
            {artifacts.length > 0 && (
              <small className="settings-cloud-saves__summary">
                {t("cloud_saves_summary", {
                  count: artifacts.length,
                  size: formatBytes(totalSizeInBytes),
                })}
              </small>
            )}

            {loading && artifacts.length === 0 && (
              <p className="settings-cloud-saves__state">
                {t("loading_cloud_saves")}
              </p>
            )}

            {!loading && artifacts.length === 0 && (
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
                    {formatNumber(group.artifacts.length)} ·{" "}
                    {formatBytes(group.totalSizeInBytes)}
                  </span>
                </div>

                <ul className="settings-cloud-saves__artifacts">
                  {group.artifacts.map((artifact) => (
                    <li
                      key={artifact.id}
                      className="settings-cloud-saves__artifact"
                    >
                      <div className="settings-cloud-saves__artifact-info">
                        <div className="settings-cloud-saves__artifact-title">
                          <span>
                            {artifact.label ??
                              t("backup_from", {
                                date: formatDate(artifact.createdAt),
                              })}
                          </span>
                          {artifact.isFrozen && (
                            <Badge>
                              <PinIcon size={12} /> {t("frozen_backup")}
                            </Badge>
                          )}
                        </div>

                        <div className="settings-cloud-saves__artifact-meta">
                          <span>
                            {formatBytes(artifact.artifactLengthInBytes)}
                          </span>
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
                        onClick={() => setArtifactToDelete(artifact)}
                        disabled={deletingArtifact || artifact.isFrozen}
                        tooltip={
                          artifact.isFrozen
                            ? t("cannot_delete_frozen_backup")
                            : undefined
                        }
                      >
                        <TrashIcon />
                        {t("delete_backup")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
