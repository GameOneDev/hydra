import assert from "node:assert/strict";
import { describe, it } from "node:test";
import util from "node:util";

import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

import {
  sanitizeAxiosError,
  sanitizeNetworkLogPayload,
} from "./network-log-payload.js";

describe("network log payload", () => {
  it("keeps nested response arrays inspectable", () => {
    const sanitized = sanitizeNetworkLogPayload({
      snapshot: { id: "snapshot", version: 2 },
      variants: [
        {
          variantId: "a".repeat(64),
          kind: "steam-account",
          steamId64: "76561198051718575",
        },
      ],
      files: [
        {
          variantId: "a".repeat(64),
          rawPath: "<winAppData>/EldenRing/<storeUserId>",
          relativePath: "ER0000.sl2",
        },
      ],
    }) as {
      files: Array<Record<string, unknown>>;
    };

    assert.equal(typeof sanitized.files[0], "object");
    assert.deepEqual(sanitized.files[0], {
      variantId: "a".repeat(64),
      rawPath: "<winAppData>/EldenRing/<storeUserId>",
      relativePath: "ER0000.sl2",
    });
  });

  it("redacts credentials recursively", () => {
    assert.deepEqual(
      sanitizeNetworkLogPayload({
        accessToken: "top-level",
        nested: {
          Authorization: "Bearer secret",
          users: [{ refreshToken: "nested" }],
        },
      }),
      {
        accessToken: "[REDACTED]",
        nested: {
          Authorization: "[REDACTED]",
          users: [{ refreshToken: "[REDACTED]" }],
        },
      }
    );
  });

  it("parses serialized request bodies before logging them", () => {
    const sanitized = sanitizeNetworkLogPayload(
      JSON.stringify({ files: [{ relativePath: "save.dat" }], token: "secret" })
    );

    assert.deepEqual(sanitized, {
      files: [{ relativePath: "save.dat" }],
      token: "[REDACTED]",
    });
  });

  it("redacts signed URL parameters without hiding ordinary URLs", () => {
    const sanitized = sanitizeNetworkLogPayload({
      sourceUrl: "https://example.com/file?part=1&X-Amz-Signature=secret",
      website: "https://example.com/games/1",
      downloadUrl: "https://example.com/private",
    }) as Record<string, string>;

    assert.match(sanitized.sourceUrl, /X-Amz-Signature=%5BREDACTED%5D/);
    assert.equal(sanitized.website, "https://example.com/games/1");
    assert.equal(sanitized.downloadUrl, "[REDACTED]");
  });

  it("redacts duplicate sensitive URL parameters", () => {
    const sanitized = sanitizeNetworkLogPayload({
      sourceUrl: "https://example.com/file?token=first&part=1&token=second",
    }) as Record<string, string>;

    assert.equal(
      sanitized.sourceUrl,
      "https://example.com/file?token=%5BREDACTED%5D&part=1"
    );
  });

  it("handles circular diagnostic objects safely", () => {
    const value: Record<string, unknown> = { status: 200 };
    value.self = value;

    assert.deepEqual(sanitizeNetworkLogPayload(value), {
      status: 200,
      self: "[Circular]",
    });
  });
});

describe("axios error sanitization", () => {
  /* Mirrors what axios builds for a failed POST: `request` is the Node
     ClientRequest whose `_header` is the raw request line. */
  const buildAxiosError = (authHeader = "Authorization") => {
    const config = {
      method: "post",
      url: "/auth/refresh",
      headers: new AxiosHeaders({
        [authHeader]: "Bearer access-token",
        "User-Agent": "Hydra Launcher",
      }),
      data: JSON.stringify({ refreshToken: "refresh-token" }),
    } as InternalAxiosRequestConfig;

    const request = {
      _header: `POST /auth/refresh HTTP/1.1\r\n${authHeader}: Bearer access-token\r\n`,
    };

    const response = {
      status: 502,
      statusText: "Bad Gateway",
      data: { message: "Bad Gateway" },
      headers: {},
      config,
      request,
    } as AxiosResponse;

    return new AxiosError(
      "Request failed with status code 502",
      "ERR_BAD_RESPONSE",
      config,
      request,
      response
    );
  };

  it("keeps credentials out of an inspected error", () => {
    const err = sanitizeAxiosError(buildAxiosError()) as AxiosError;
    const inspected = util.inspect(err, { depth: null });

    assert.equal(err.request, undefined);
    assert.equal(err.response?.request, undefined);
    assert.equal(err.config?.headers.Authorization, "[REDACTED]");
    assert.deepEqual(err.config?.data, { refreshToken: "[REDACTED]" });
    assert.ok(!inspected.includes("access-token"));
    assert.ok(!inspected.includes("refresh-token"));
  });

  it("redacts an authorization header whatever its casing", () => {
    const err = sanitizeAxiosError(buildAxiosError("authorization"));

    assert.ok(!util.inspect(err, { depth: null }).includes("access-token"));
  });

  it("leaves the error usable by its callers", () => {
    const err = sanitizeAxiosError(buildAxiosError()) as AxiosError;

    assert.ok(err instanceof AxiosError);
    assert.equal(err.response?.status, 502);
    assert.equal(err.message, "Request failed with status code 502");
    assert.deepEqual(err.response?.data, { message: "Bad Gateway" });
  });

  it("passes non-axios errors through untouched", () => {
    const err = new Error("boom");

    assert.equal(sanitizeAxiosError(err), err);
  });
});
