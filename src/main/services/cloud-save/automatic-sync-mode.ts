import type { CloudSaveAutomaticSyncMode, GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

export type { CloudSaveAutomaticSyncMode } from "@types";

/** Feature string a cloud server advertises when it implements Cloud Save V2. */
export const CLOUD_SAVE_V2_FEATURE = "cloud-saves-v2";

/** Advertised by a server whose Cloud Save V2 also accepts Epic games, which
    launcher 4.2.0 started syncing. Older servers refuse `shop=epic`. */
export const CLOUD_SAVE_V2_EPIC_FEATURE = "cloud-saves-v2-epic";

/** The capability a server needs before Cloud Save V2 can run for `shop`. */
export const getCloudSaveV2FeaturesForShop = (shop?: GameShop | null) =>
  shop === "epic"
    ? [CLOUD_SAVE_V2_FEATURE, CLOUD_SAVE_V2_EPIC_FEATURE]
    : [CLOUD_SAVE_V2_FEATURE];

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
  v2Supported = true
) => {
  if (shop === "steam") {
    return resolveStoredCloudSaveAutomaticSyncMode(
      legacyEnabled,
      storedV2Enabled,
      v2Supported
    );
  }
  if (shop === "epic" || getCloudSaveEmulatorProvider(shop, platform)) {
    /* Epic and emulator saves only ever sync through V2, so a server without
       it gets nothing rather than a legacy flow upstream doesn't offer them. */
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
