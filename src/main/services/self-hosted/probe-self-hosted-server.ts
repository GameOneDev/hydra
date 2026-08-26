import axios from "axios";

import type {
  SelfHostedServerProbe,
  SelfHostedServerState,
  SelfHostedServerStatus,
} from "@types";

/** Unauthenticated health check: `{ name, status, version }`. */
export const HEALTH_PATH = "/health";

/** Unauthenticated feature list the launcher gates cloud features on. */
export const CAPABILITIES_PATH = "/capabilities";

/** Value `/health` reports when the server considers itself healthy. */
export const HEALTHY_STATUS = "ok";

/* A 2xx body with no status field isn't a Hydra server answering, whatever
   else is on that URL. */
const MISSING_STATUS_REASON = "unexpected response";

export const DEFAULT_PROBE_TIMEOUT_IN_MS = 10_000;

export interface ProbeResponse {
  statusCode: number;
  data: unknown;
}

/** Elapsed milliseconds since the stopwatch was created. */
export type Stopwatch = () => number;

export interface ProbeSelfHostedServerOptions {
  timeoutInMs?: number;
  userAgent?: string;
  /** Seam for tests; defaults to a plain unauthenticated GET. */
  request?: (url: string, timeoutInMs: number) => Promise<ProbeResponse>;
  /** Seam for tests; defaults to a monotonic clock per endpoint read. */
  stopwatch?: () => Stopwatch;
}

/* Re-exported from the shared module the settings page validates with, so the
   URL this probe accepts and the URL that page lets the user save are decided
   by the same two functions. Imported by path rather than through "@shared",
   whose barrel pulls in browser-only modules. */
export {
  isValidSelfHostedUrl,
  normalizeSelfHostedUrl,
} from "../../../shared/self-hosted-url.js";

/**
 * Turns whatever went wrong into something a user can act on. Both probed
 * endpoints are unauthenticated and carry no user data, so the raw reason is
 * safe to surface.
 */
const describeError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    if (error.response) return `HTTP ${error.response.status}`;
    if (error.code) return error.code;
  }

  if (error instanceof Error && error.message) return error.message;

  return "UNKNOWN_ERROR";
};

const startStopwatch = (): Stopwatch => {
  const startedAt = performance.now();
  return () => Math.max(0, Math.round(performance.now() - startedAt));
};

const requestJson = async (
  url: string,
  timeoutInMs: number,
  userAgent?: string
) => {
  const { status, data } = await axios.get<unknown>(url, {
    timeout: timeoutInMs,
    headers: userAgent ? { "User-Agent": userAgent } : undefined,
  });

  return { statusCode: status, data };
};

interface EndpointResult {
  statusCode: number | null;
  latencyInMs: number | null;
  data: Record<string, unknown>;
  error: string | null;
}

const asRecord = (data: unknown): Record<string, unknown> =>
  typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : {};

const asString = (value: unknown) =>
  typeof value === "string" && value ? value : null;

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

/** Reads one endpoint, timing it, and never throws. */
const readEndpoint = async (
  url: string,
  timeoutInMs: number,
  request: (url: string, timeoutInMs: number) => Promise<ProbeResponse>,
  stopwatch: () => Stopwatch
): Promise<EndpointResult> => {
  const elapsed = stopwatch();

  try {
    const { statusCode, data } = await request(url, timeoutInMs);

    return {
      statusCode,
      latencyInMs: elapsed(),
      data: asRecord(data),
      error: null,
    };
  } catch (error) {
    const statusCode = axios.isAxiosError(error)
      ? (error.response?.status ?? null)
      : null;

    return {
      statusCode,
      /* A status code means the host answered, so the round trip is real. */
      latencyInMs: statusCode !== null ? elapsed() : null,
      data: {},
      error: describeError(error),
    };
  }
};

/**
 * Pings a self-hosted server: `/health` for liveness, version and round trip,
 * `/capabilities` for the feature list the launcher gates cloud features on.
 *
 * Both are read in parallel, so the probe costs one round trip of wall time.
 * `/health` is the liveness signal — every Hydra server serves it, so failing
 * it (or reporting anything other than `ok`) is a broken server, not an old
 * one. A readable `/health` with unreadable capabilities is degraded too: the
 * features routed to that server would silently stay off.
 *
 * Never throws: every failure comes back as a result, because both callers —
 * the status monitor and the settings connection test — want to render the
 * failure rather than crash on it.
 */
export const probeSelfHostedServer = async (
  baseUrl: string,
  options: ProbeSelfHostedServerOptions = {}
): Promise<SelfHostedServerProbe> => {
  const {
    timeoutInMs = DEFAULT_PROBE_TIMEOUT_IN_MS,
    userAgent,
    request = (url, timeout) => requestJson(url, timeout, userAgent),
    stopwatch = startStopwatch,
  } = options;

  const [health, capabilities] = await Promise.all([
    readEndpoint(`${baseUrl}${HEALTH_PATH}`, timeoutInMs, request, stopwatch),
    readEndpoint(
      `${baseUrl}${CAPABILITIES_PATH}`,
      timeoutInMs,
      request,
      stopwatch
    ),
  ]);

  const status = asString(health.data.status);

  const resolveError = () => {
    /* Nothing answered at all: the bare connection error is what the user
       needs to see (ECONNREFUSED, ETIMEDOUT, DNS), unprefixed. */
    if (health.statusCode === null) return health.error;

    if (health.error !== null) return `${HEALTH_PATH}: ${health.error}`;

    if (status === null) return `${HEALTH_PATH}: ${MISSING_STATUS_REASON}`;
    if (status !== HEALTHY_STATUS) return `${HEALTH_PATH}: ${status}`;

    if (capabilities.error !== null) {
      return `${CAPABILITIES_PATH}: ${capabilities.error}`;
    }

    return null;
  };

  return {
    reachable: health.statusCode !== null,
    statusCode: health.statusCode,
    latencyInMs: health.latencyInMs,
    name: asString(health.data.name),
    status,
    version: asString(health.data.version),
    features: asStringArray(capabilities.data.features),
    error: resolveError(),
  };
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
