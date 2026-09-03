import { deleteRemoteGameCloudSaveSnapshots } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "deleteRemoteGameCloudSaveSnapshots",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => {
    await deleteRemoteGameCloudSaveSnapshots(objectId, shop);
  }
);
