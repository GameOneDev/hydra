import { restoreRemoteGameCloudSaveVersion } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "restoreRemoteGameCloudSaveVersion",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    snapshotId: string
  ) => {
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_game_running");
    }

    return restoreRemoteGameCloudSaveVersion(objectId, shop, snapshotId);
  }
);
