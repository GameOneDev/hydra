import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

/**
 * Pings a server URL the user typed but hasn't saved yet, so a broken URL is
 * caught in settings instead of after a relaunch.
 */
registerEvent(
  "testSelfHostedServer",
  (_event: Electron.IpcMainInvokeEvent, url: string) =>
    HydraApi.testSelfHostedServer(url)
);
