import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import type { SelfHostedServerProbe } from "@types";

import {
  isValidSelfHostedUrl,
  normalizeSelfHostedUrl,
  probeSelfHostedServer,
  resolveSelfHostedServerStatus,
} from "./probe-self-hosted-server.js";

const BASE_URL = "https://cloud.example.com";

const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;

const axiosErrorWithStatus = (status: number) =>
  new AxiosError("Request failed", "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data: null,
  } as AxiosResponse);

const axiosErrorWithoutResponse = (code: string) =>
  new AxiosError("connect failed", code, config);

const healthPayload = {
  name: "hydra-server",
  status: "ok",
  version: "4.1.1",
};

const capabilitiesPayload = { features: ["hidden-games", "cloud-saves-v2"] };

/** Answers each endpoint from a map, and records what was requested. */
const serverAnswering = (
  answers: Record<string, () => { statusCode: number; data: unknown }>
) => {
  const requested: string[] = [];

  const request = async (url: string) => {
    requested.push(url);

    const answer = answers[new URL(url).pathname];
    if (!answer) throw axiosErrorWithStatus(404);

    return answer();
  };

  return { request, requested };
};

const probe = (
  answers: Record<string, () => { statusCode: number; data: unknown }>,
  latencyInMs = 42
) => {
  const { request, requested } = serverAnswering(answers);

  return probeSelfHostedServer(BASE_URL, {
    request,
    stopwatch: () => () => latencyInMs,
  }).then((result) => ({ result, requested }));
};

const ok = (data: unknown) => () => ({ statusCode: 200, data });

const failingWith = (error: unknown) => () => {
  throw error;
};

describe("normalizeSelfHostedUrl", () => {
  it("strips trailing slashes and surrounding whitespace", () => {
    assert.equal(
      normalizeSelfHostedUrl("  https://cloud.example.com///  "),
      BASE_URL
    );
  });

  it("treats blank values as no server", () => {
    assert.equal(normalizeSelfHostedUrl("   "), null);
    assert.equal(normalizeSelfHostedUrl(""), null);
    assert.equal(normalizeSelfHostedUrl(null), null);
    assert.equal(normalizeSelfHostedUrl(undefined), null);
  });
});

describe("isValidSelfHostedUrl", () => {
  it("accepts http and https", () => {
    assert.equal(isValidSelfHostedUrl("http://localhost:3000"), true);
    assert.equal(isValidSelfHostedUrl(BASE_URL), true);
  });

  it("rejects anything else", () => {
    assert.equal(isValidSelfHostedUrl("cloud.example.com"), false);
    assert.equal(isValidSelfHostedUrl("ftp://cloud.example.com"), false);
    assert.equal(isValidSelfHostedUrl(""), false);
  });
});

describe("probeSelfHostedServer", () => {
  it("reads status and version from /health and features from /capabilities", async () => {
    const { result, requested } = await probe({
      "/health": ok(healthPayload),
      "/capabilities": ok(capabilitiesPayload),
    });

    assert.deepEqual(requested.sort(), [
      `${BASE_URL}/capabilities`,
      `${BASE_URL}/health`,
    ]);
    assert.equal(result.reachable, true);
    assert.equal(result.statusCode, 200);
    assert.equal(result.latencyInMs, 42);
    assert.equal(result.name, "hydra-server");
    assert.equal(result.status, "ok");
    assert.equal(result.version, "4.1.1");
    assert.deepEqual(result.features, ["hidden-games", "cloud-saves-v2"]);
    assert.equal(result.error, null);
  });

  it("ignores non-string entries in the feature list", async () => {
    const { result } = await probe({
      "/health": ok(healthPayload),
      "/capabilities": ok({ features: ["hidden-games", 7, null] }),
    });

    assert.deepEqual(result.features, ["hidden-games"]);
  });

  /* Every Hydra server serves /health, so a URL without it is the wrong URL,
     not an old server. */
  it("reports a server with no health endpoint as unhealthy", async () => {
    const { result } = await probe({
      "/capabilities": ok(capabilitiesPayload),
    });

    assert.equal(result.reachable, true);
    assert.equal(result.error, "/health: HTTP 404");
    assert.equal(result.version, null);
  });

  it("reports a health response that carries no status", async () => {
    const { result } = await probe({
      "/health": ok({ hello: "world" }),
      "/capabilities": ok(capabilitiesPayload),
    });

    assert.equal(result.reachable, true);
    assert.equal(result.status, null);
    assert.equal(result.error, "/health: unexpected response");
  });

  it("reports a server that says it is unhealthy", async () => {
    const { result } = await probe({
      "/health": ok({ ...healthPayload, status: "degraded" }),
      "/capabilities": ok(capabilitiesPayload),
    });

    assert.equal(result.reachable, true);
    assert.equal(result.status, "degraded");
    assert.equal(result.error, "/health: degraded");
  });

  it("reports a health endpoint that exists and fails", async () => {
    const { result } = await probe({
      "/health": failingWith(axiosErrorWithStatus(500)),
      "/capabilities": ok(capabilitiesPayload),
    });

    assert.equal(result.reachable, true);
    assert.equal(result.error, "/health: HTTP 500");
  });

  /* Capabilities is what the launcher gates cloud features on, so losing it
     is the failure that matters most — even with a healthy /health. */
  it("reports missing capabilities even when the server is healthy", async () => {
    const { result } = await probe({
      "/health": ok(healthPayload),
    });

    assert.equal(result.reachable, true);
    assert.equal(result.error, "/capabilities: HTTP 404");
    assert.deepEqual(result.features, []);
    assert.equal(result.version, "4.1.1");
  });

  it("reports a connection failure as unreachable", async () => {
    const { result } = await probe({
      "/health": failingWith(axiosErrorWithoutResponse("ECONNREFUSED")),
      "/capabilities": failingWith(axiosErrorWithoutResponse("ECONNREFUSED")),
    });

    assert.equal(result.reachable, false);
    assert.equal(result.statusCode, null);
    assert.equal(result.latencyInMs, null);
    assert.equal(result.error, "ECONNREFUSED");
  });

  it("never throws, whatever the request does", async () => {
    const { result } = await probe({
      "/health": failingWith(new Error("boom")),
      "/capabilities": failingWith(new Error("boom")),
    });

    assert.equal(result.reachable, false);
    assert.equal(result.error, "boom");
  });
});

describe("resolveSelfHostedServerStatus", () => {
  const probeOf = (
    overrides: Partial<SelfHostedServerProbe> = {}
  ): SelfHostedServerProbe => ({
    reachable: true,
    statusCode: 200,
    latencyInMs: 20,
    name: "hydra-server",
    status: "ok",
    version: "4.1.1",
    features: ["hidden-games"],
    error: null,
    ...overrides,
  });

  it("is online when the server is healthy and its features are known", () => {
    const status = resolveSelfHostedServerStatus(BASE_URL, probeOf(), 1700);

    assert.equal(status.state, "online");
    assert.equal(status.url, BASE_URL);
    assert.equal(status.latencyInMs, 20);
    assert.equal(status.version, "4.1.1");
    assert.equal(status.checkedAt, 1700);
  });

  it("is degraded when the server answered with a reason", () => {
    const status = resolveSelfHostedServerStatus(
      BASE_URL,
      probeOf({ features: [], error: "/capabilities: HTTP 404" }),
      1700
    );

    assert.equal(status.state, "degraded");
    assert.equal(status.error, "/capabilities: HTTP 404");
  });

  it("is offline when nothing answered", () => {
    const status = resolveSelfHostedServerStatus(
      BASE_URL,
      probeOf({
        reachable: false,
        statusCode: null,
        latencyInMs: null,
        name: null,
        status: null,
        version: null,
        features: [],
        error: "ETIMEDOUT",
      }),
      1700
    );

    assert.equal(status.state, "offline");
    assert.equal(status.latencyInMs, null);
  });
});
