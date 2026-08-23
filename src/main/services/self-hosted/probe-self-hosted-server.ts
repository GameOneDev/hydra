import axios from "axios";

import type {
  SelfHostedServerProbe,
  SelfHostedServerState,
  SelfHostedServerStatus,
} from "@types";

/** Unauthenticated endpoint every Hydra Cloud server answers. */
export const CAPABILITIES_PATH = "/capabilities";

export const DEFAULT_PROBE_TIMEOUT_IN_MS = 10_000;

interface CapabilitiesResponse {
  version?: string;
  features?: string[];
}

export interface ProbeResponse {
  statusCode: number;
  data: unknown;
}

export interface ProbeSelfHostedServerOptions {
  timeoutInMs?: number;
  userAgent?: string;
  /** Seam for tests; defaults to a plain unauthenticated GET. */
  request?: (url: string, timeoutInMs: number) => Promise<ProbeResponse>;
  /** Seam for tests; defaults to a monotonic clock. */
  now?: () => number;
}

export const normalizeSelfHostedUrl = (url?: string | null) => {
  const trimmed = url?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : null;
};

export const isValidSelfHostedUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Turns whatever went wrong into something a user can act on. `/capabilities`
 * is unauthenticated and carries no user data, so the raw reason is safe to
 * surface.
 */
const describeError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    if (error.response) return `HTTP ${error.response.status}`;
    if (error.code) return error.code;
  }

  if (error instanceof Error && error.message) return error.message;

  return "UNKNOWN_ERROR";
};

const requestCapabilities = async (
  url: string,
  timeoutInMs: number,
  userAgent?: string
) => {
  const { status, data } = await axios.get<CapabilitiesResponse>(url, {
    timeout: timeoutInMs,
    headers: userAgent ? { "User-Agent": userAgent } : undefined,
  });

  return { statusCode: status, data };
};

/**
 * Reads `/capabilities` from a self-hosted server and times the round trip.
 *
 * Never throws: every failure comes back as an unreachable (or non-2xx)
 * result, because the two callers — the status monitor and the settings
 * connection test — both want to render the failure rather than crash on it.
 */
export const probeSelfHostedServer = async (
  baseUrl: string,
  options: ProbeSelfHostedServerOptions = {}
): Promise<SelfHostedServerProbe> => {
  const {
    timeoutInMs = DEFAULT_PROBE_TIMEOUT_IN_MS,
    userAgent,
    request = (url, timeout) => requestCapabilities(url, timeout, userAgent),
    now = () => performance.now(),
  } = options;

  const startedAt = now();

  try {
    const { statusCode, data } = await request(
      `${baseUrl}${CAPABILITIES_PATH}`,
      timeoutInMs
    );

    const latencyInMs = Math.max(0, Math.round(now() - startedAt));
    const capabilities = (data ?? {}) as CapabilitiesResponse;

    return {
      reachable: true,
      statusCode,
      latencyInMs,
      version:
        typeof capabilities.version === "string" ? capabilities.version : null,
      features: Array.isArray(capabilities.features)
        ? capabilities.features.filter(
            (feature): feature is string => typeof feature === "string"
          )
        : [],
      error: null,
    };
  } catch (error) {
    const statusCode = axios.isAxiosError(error)
      ? (error.response?.status ?? null)
      : null;

    return {
      /* A status code means the host answered — it just isn't serving
         capabilities on this URL. */
      reachable: statusCode !== null,
      statusCode,
      latencyInMs:
        statusCode !== null ? Math.max(0, Math.round(now() - startedAt)) : null,
      version: null,
      features: [],
      error: describeError(error),
    };
  }
};

const resolveState = (probe: SelfHostedServerProbe): SelfHostedServerState => {
  if (!probe.reachable) return "offline";
  return probe.error === null ? "online" : "degraded";
};

/** Shapes a probe into the status both renderers render. */
export const resolveSelfHostedServerStatus = (
  url: string,
  probe: SelfHostedServerProbe,
  checkedAt: number
): SelfHostedServerStatus => ({
  url,
  state: resolveState(probe),
  latencyInMs: probe.latencyInMs,
  version: probe.version,
  features: probe.features,
  error: probe.error,
  checkedAt,
});

export const disabledSelfHostedServerStatus = (): SelfHostedServerStatus => ({
  url: null,
  state: "disabled",
  latencyInMs: null,
  version: null,
  features: [],
  error: null,
  checkedAt: null,
});
