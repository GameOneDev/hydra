/**
 * Reachability of the configured self-hosted cloud storage server.
 *
 * - `disabled`: no server configured, everything runs against official Hydra
 * - `checking`: a probe is in flight and no answer has landed yet
 * - `online`: the server answered `/capabilities` and its features are known
 * - `degraded`: the server answered, but not with capabilities (an older
 *   deployment, or a URL pointing at something that is not Hydra Cloud) —
 *   features gated on capabilities stay off
 * - `offline`: nothing answered (wrong URL, server down, network blocked)
 */
export type SelfHostedServerState =
  | "disabled"
  | "checking"
  | "online"
  | "degraded"
  | "offline";

/** Outcome of a single `/capabilities` request against a server URL. */
export interface SelfHostedServerProbe {
  /** Whether the host answered at all, whatever the status code. */
  reachable: boolean;
  /** HTTP status the server answered with, `null` when it never answered. */
  statusCode: number | null;
  /** Round trip of the probe request in milliseconds. */
  latencyInMs: number | null;
  version: string | null;
  features: string[];
  /** Short, human readable reason the probe did not succeed. */
  error: string | null;
}

/** Last known state of the configured self-hosted server. */
export interface SelfHostedServerStatus {
  url: string | null;
  state: SelfHostedServerState;
  latencyInMs: number | null;
  version: string | null;
  features: string[];
  error: string | null;
  /** `Date.now()` of the last completed probe. */
  checkedAt: number | null;
}
