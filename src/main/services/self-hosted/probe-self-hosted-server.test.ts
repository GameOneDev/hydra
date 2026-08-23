import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

import {
  isValidSelfHostedUrl,
  normalizeSelfHostedUrl,
  probeSelfHostedServer,
  resolveSelfHostedServerStatus,
} from "./probe-self-hosted-server.js";

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

/* A clock that advances a fixed amount per read, so latency is deterministic:
   the probe reads it once before and once after the request. */
const clockAdvancingBy = (stepInMs: number) => {
  let current = 0;

  return () => {
    const value = current;
    current += stepInMs;
    return value;
  };
};

describe("normalizeSelfHostedUrl", () => {
  it("strips trailing slashes and surrounding whitespace", () => {
    assert.equal(
      normalizeSelfHostedUrl("  https://cloud.example.com///  "),
      "https://cloud.example.com"
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
    assert.equal(isValidSelfHostedUrl("https://cloud.example.com"), true);
  });

  it("rejects anything else", () => {
    assert.equal(isValidSelfHostedUrl("cloud.example.com"), false);
    assert.equal(isValidSelfHostedUrl("ftp://cloud.example.com"), false);
    assert.equal(isValidSelfHostedUrl(""), false);
  });
});

describe("probeSelfHostedServer", () => {
  it("reads the version and features off a capabilities response", async () => {
    const requested: string[] = [];

    const probe = await probeSelfHostedServer("https://cloud.example.com", {
      now: clockAdvancingBy(42),
      request: async (url) => {
        requested.push(url);
        return {
          statusCode: 200,
          data: { version: "1.4.0", features: ["hidden-games", 7, null] },
        };
      },
    });

    assert.deepEqual(requested, ["https://cloud.example.com/capabilities"]);
    assert.equal(probe.reachable, true);
    assert.equal(probe.statusCode, 200);
    assert.equal(probe.latencyInMs, 42);
    assert.equal(probe.version, "1.4.0");
    assert.deepEqual(probe.features, ["hidden-games"]);
    assert.equal(probe.error, null);
  });

  it("tolerates a server that answers without a capabilities payload", async () => {
    const probe = await probeSelfHostedServer("https://cloud.example.com", {
      now: clockAdvancingBy(10),
      request: async () => ({ statusCode: 204, data: null }),
    });

    assert.equal(probe.reachable, true);
    assert.equal(probe.version, null);
    assert.deepEqual(probe.features, []);
    assert.equal(probe.error, null);
  });

  /* A server predating /capabilities answers 404: it IS reachable, but the
     launcher still knows nothing about its features. */
  it("reports an HTTP error as reachable with the status as the reason", async () => {
    const probe = await probeSelfHostedServer("https://cloud.example.com", {
      now: clockAdvancingBy(5),
      request: async () => {
        throw axiosErrorWithStatus(404);
      },
    });

    assert.equal(probe.reachable, true);
    assert.equal(probe.statusCode, 404);
    assert.equal(probe.latencyInMs, 5);
    assert.equal(probe.error, "HTTP 404");
    assert.deepEqual(probe.features, []);
  });

  it("reports a connection failure as unreachable", async () => {
    const probe = await probeSelfHostedServer("https://cloud.example.com", {
      request: async () => {
        throw axiosErrorWithoutResponse("ECONNREFUSED");
      },
    });

    assert.equal(probe.reachable, false);
    assert.equal(probe.statusCode, null);
    assert.equal(probe.latencyInMs, null);
    assert.equal(probe.error, "ECONNREFUSED");
  });

  it("never throws, whatever the request does", async () => {
    const probe = await probeSelfHostedServer("https://cloud.example.com", {
      request: async () => {
        throw new Error("boom");
      },
    });

    assert.equal(probe.reachable, false);
    assert.equal(probe.error, "boom");
  });
});

describe("resolveSelfHostedServerStatus", () => {
  const probeOf = (
    overrides: Partial<Awaited<ReturnType<typeof probeSelfHostedServer>>>
  ) => ({
    reachable: true,
    statusCode: 200,
    latencyInMs: 20,
    version: "1.4.0",
    features: ["hidden-games"],
    error: null,
    ...overrides,
  });

  it("is online when capabilities came back", () => {
    const status = resolveSelfHostedServerStatus(
      "https://cloud.example.com",
      probeOf({}),
      1700
    );

    assert.equal(status.state, "online");
    assert.equal(status.url, "https://cloud.example.com");
    assert.equal(status.latencyInMs, 20);
    assert.equal(status.version, "1.4.0");
    assert.equal(status.checkedAt, 1700);
  });

  it("is degraded when the server answered with something else", () => {
    const status = resolveSelfHostedServerStatus(
      "https://cloud.example.com",
      probeOf({
        statusCode: 404,
        version: null,
        features: [],
        error: "HTTP 404",
      }),
      1700
    );

    assert.equal(status.state, "degraded");
    assert.equal(status.error, "HTTP 404");
  });

  it("is offline when nothing answered", () => {
    const status = resolveSelfHostedServerStatus(
      "https://cloud.example.com",
      probeOf({
        reachable: false,
        statusCode: null,
        latencyInMs: null,
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
