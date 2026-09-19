import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("refreshSelfHostedStatus", () =>
  HydraApi.refreshSelfHostedStatus()
);
