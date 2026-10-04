import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

registerEvent("getSelfHostedStatus", () =>
  Promise.resolve(HydraApi.getSelfHostedStatus())
);
