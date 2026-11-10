import type { CloudSaveAutomaticSyncMode, GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";
import { parseRecompilationCloudSaveObjectId } from "../../../shared/recompilations.js";

export type { CloudSaveAutomaticSyncMode } from "@types";

/** Feature string a cloud server advertises when it implements Cloud Save V2. */
export const CLOUD_SAVE_V2_FEATURE = "cloud-saves-v2";

/** Advertised by a server whose Cloud Save V2 also accepts Epic games, which
    launcher 4.2.0 started syncing. Older servers refuse `shop=epic`. */
export const CLOUD_SAVE_V2_EPIC_FEATURE = "cloud-saves-v2-epic";

/** Advertised by a server whose Cloud Save V2 keeps a recompilation's saves
    apart from the plain game's. Launcher 4.4.0 sends the port as a separate
    `recompilationSlug` next to the LaunchBox game's own id; a server that
    ignores it files the port's saves under the plain game — and deletes that
    game's emulator saves when the port's are deleted. */
export const CLOUD_SAVE_V2_RECOMPILATION_FEATURE =
  "cloud-saves-v2-recompilation";

/**
 * The capability a server needs before Cloud Save V2 can run for a game.
 *
 * `objectId` is what tells a recompilation from the LaunchBox game it is a port
 * of, since both are `launchbox`; without it a recompilation is judged as the
 * plain game and would sync to a server that cannot tell them apart.
 */
export const getCloudSaveV2FeaturesForShop = (
  shop?: GameShop | null,
  objectId?: string | null
) => {
  if (shop === "epic") {
    return [CLOUD_SAVE_V2_FEATURE, CLOUD_SAVE_V2_EPIC_FEATURE];
  }
  if (shop && objectId && parseRecompilationCloudSaveObjectId(shop, objectId)) {
    return [CLOUD_SAVE_V2_FEATURE, CLOUD_SAVE_V2_RECOMPILATION_FEATURE];
  }
  return [CLOUD_SAVE_V2_FEATURE];
};

export interface CloudSaveAutomaticSyncState {
  legacyEnabled: boolean;
  v2Enabled: boolean;
}

export const resolveCloudSaveAutomaticSyncMode = ({
  legacyEnabled,
  v2Enabled,
}: CloudSaveAutomaticSyncState): CloudSaveAutomaticSyncMode => {
  if (v2Enabled) return "v2";
  if (legacyEnabled) return "legacy";
  return "disabled";
};

/**
 * V2 is the default for Steam games when nothing is stored, but only where the
 * cloud server can actually serve it. A self-hosted server that predates the
 * V2 endpoints reports `v2Supported: false`, and the game falls back to the
 * legacy flow instead of syncing against endpoints that answer 404.
 */
export const resolveStoredCloudSaveAutomaticSyncMode = (
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined,
  v2Supported = true
) =>
  resolveCloudSaveAutomaticSyncMode({
    legacyEnabled,
    v2Enabled: v2Supported && (storedV2Enabled ?? true),
  });

export const resolveStoredCloudSaveAutomaticSyncModeForShop = (
  shop: GameShop,
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined,
  platform?: string | null,
  v2Supported = true,
  objectId?: string
) => {
  if (shop === "steam") {
    return resolveStoredCloudSaveAutomaticSyncMode(
      legacyEnabled,
      storedV2Enabled,
      v2Supported
    );
  }
  if (
    shop === "epic" ||
    getCloudSaveEmulatorProvider(shop, platform) ||
    (objectId !== undefined &&
      parseRecompilationCloudSaveObjectId(shop, objectId))
  ) {
    /* Epic, emulator and recompilation saves only ever sync through V2, so a
       server without it gets nothing rather than a legacy flow upstream doesn't
       offer them. */
    return resolveCloudSaveAutomaticSyncMode({
      legacyEnabled: false,
      v2Enabled: v2Supported && (storedV2Enabled ?? true),
    });
  }
  return resolveCloudSaveAutomaticSyncMode({
    legacyEnabled,
    v2Enabled: false,
  });
};

export const getCloudSaveAutomaticSyncStateForMode = (
  mode: CloudSaveAutomaticSyncMode
): CloudSaveAutomaticSyncState => ({
  legacyEnabled: mode === "legacy",
  v2Enabled: mode === "v2",
});

export const getNextCloudSaveAutomaticSyncMode = (
  currentMode: CloudSaveAutomaticSyncMode,
  targetMode: Exclude<CloudSaveAutomaticSyncMode, "disabled">,
  enabled: boolean
): CloudSaveAutomaticSyncMode => {
  if (enabled) return targetMode;
  return currentMode === targetMode ? "disabled" : currentMode;
};

export const shouldRunLegacyAutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "legacy";

export const shouldRunV2AutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "v2";
