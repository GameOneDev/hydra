import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeHdCopyFailure,
  getHdCopyErrorStatus,
  uploadHdCopy,
  type HdCopyOutcome,
  type HdCopyUploadDeps,
} from "./screenshot-hd-copy-uploader.js";

const source = {
  screenshotId: "shot-1",
  path: "/captures/a.png",
  visibility: "FRIENDS" as const,
};

const httpError = (status: number) =>
  Object.assign(new Error(`status ${status}`), { response: { status } });

const fsError = (code: string) => Object.assign(new Error(code), { code });

/* Fakes that record what happened, in order, and can fail at one step. */
const build = (failAt?: { step: keyof HdCopyUploadDeps; error: unknown }) => {
  const calls: string[] = [];
  const saved: unknown[] = [];

  const step =
    <T>(name: keyof HdCopyUploadDeps, value: T) =>
    async () => {
      calls.push(name);
      if (failAt?.step === name) throw failAt.error;
      return value;
    };

  const deps: HdCopyUploadDeps = {
    readOriginal: step("readOriginal", Buffer.from("original")),
    compress: step("compress", {
      image: Buffer.alloc(1234),
      width: 1920,
      height: 1080,
    }),
    requestUploadUrl: async (screenshotId, imageLength) => {
      calls.push(`requestUploadUrl:${screenshotId}:${imageLength}`);
      if (failAt?.step === "requestUploadUrl") throw failAt.error;
      return {
        presignedUrl: "https://mine.test/storage/token",
        imageUrl: "https://mine.test/images/screenshots-hd/u/x.jpg",
      };
    },
    putImage: async (url, image) => {
      calls.push(`putImage:${url}:${image.byteLength}`);
      if (failAt?.step === "putImage") throw failAt.error;
    },
    saveCopy: async (screenshotId, copy) => {
      calls.push(`saveCopy:${screenshotId}`);
      saved.push(copy);
      if (failAt?.step === "saveCopy") throw failAt.error;
    },
  };

  return { deps, calls, saved };
};

/* Which stage each fake step belongs to. */
const STAGE_OF_STEP = {
  readOriginal: "read",
  compress: "compress",
  requestUploadUrl: "upload-url",
  putImage: "upload",
  saveCopy: "save",
} as const;

const failureOf = (outcome: HdCopyOutcome) => {
  assert.notEqual(outcome.kind, "uploaded");
  return (outcome as Exclude<HdCopyOutcome, { kind: "uploaded" }>).failure;
};

const skippedReason = (outcome: HdCopyOutcome) =>
  outcome.kind === "skipped" ? outcome.reason : undefined;

const retryError = (outcome: HdCopyOutcome) =>
  outcome.kind === "retry" ? outcome.error : undefined;

describe("uploading a 1080p copy", () => {
  it("uploads the compressed image, then records it with its size and visibility", async () => {
    const { deps, calls, saved } = build();

    assert.deepEqual(await uploadHdCopy(source, deps), { kind: "uploaded" });

    assert.deepEqual(calls, [
      "readOriginal",
      "compress",
      "requestUploadUrl:shot-1:1234",
      "putImage:https://mine.test/storage/token:1234",
      "saveCopy:shot-1",
    ]);
    assert.deepEqual(saved, [
      {
        imageUrl: "https://mine.test/images/screenshots-hd/u/x.jpg",
        width: 1920,
        height: 1080,
        visibility: "FRIENDS",
      },
    ]);
  });

  it("gives up on a capture that is gone, and does not ask the server", async () => {
    const { deps, calls } = build({
      step: "readOriginal",
      error: fsError("ENOENT"),
    });

    const outcome = await uploadHdCopy(source, deps);

    assert.equal(outcome.kind, "skipped");
    assert.equal(skippedReason(outcome), "original_missing");
    assert.equal(failureOf(outcome).stage, "read");
    assert.deepEqual(calls, ["readOriginal"]);
  });

  it("tries a capture again whose read failed for another reason", async () => {
    const error = fsError("EBUSY");
    const { deps } = build({ step: "readOriginal", error });

    const outcome = await uploadHdCopy(source, deps);

    assert.equal(outcome.kind, "retry");
    assert.equal(retryError(outcome), error);
    assert.deepEqual(
      { stage: failureOf(outcome).stage, code: failureOf(outcome).code },
      { stage: "read", code: "EBUSY" }
    );
  });

  it("gives up on a capture that cannot be compressed, since it never will", async () => {
    const { deps, calls } = build({
      step: "compress",
      error: new Error("screenshot_unreadable"),
    });

    const outcome = await uploadHdCopy(source, deps);

    assert.equal(skippedReason(outcome), "unreadable");
    assert.deepEqual(
      { stage: failureOf(outcome).stage, message: failureOf(outcome).message },
      { stage: "compress", message: "screenshot_unreadable" }
    );
    assert.deepEqual(calls, ["readOriginal", "compress"]);
  });

  for (const step of ["requestUploadUrl", "putImage", "saveCopy"] as const) {
    it(`tries again when ${step} cannot reach the server`, async () => {
      const error = new Error("socket hang up");
      const { deps } = build({ step, error });

      const outcome = await uploadHdCopy(source, deps);

      assert.equal(outcome.kind, "retry");
      assert.equal(retryError(outcome), error);
      assert.equal(failureOf(outcome).stage, STAGE_OF_STEP[step]);
      assert.equal(failureOf(outcome).message, "socket hang up");
    });

    it(`tries again when ${step} meets a server error`, async () => {
      const { deps } = build({ step, error: httpError(503) });

      assert.equal((await uploadHdCopy(source, deps)).kind, "retry");
    });

    it(`gives up when ${step} is refused for good`, async () => {
      const { deps } = build({ step, error: httpError(404) });

      const outcome = await uploadHdCopy(source, deps);

      assert.equal(skippedReason(outcome), "rejected");
      assert.equal(failureOf(outcome).stage, STAGE_OF_STEP[step]);
      assert.equal(failureOf(outcome).status, 404);
    });
  }

  it("treats a quota refusal as final for this screenshot", async () => {
    const { deps } = build({ step: "requestUploadUrl", error: httpError(413) });

    const outcome = await uploadHdCopy(source, deps);

    assert.equal(skippedReason(outcome), "rejected");
    assert.equal(failureOf(outcome).status, 413);
  });

  it("tries again when the bytes had not landed by the time it was saved", async () => {
    /* The server answers 409 for an upload it cannot find yet. */
    const { deps } = build({ step: "saveCopy", error: httpError(409) });

    assert.equal((await uploadHdCopy(source, deps)).kind, "retry");
  });

  it("sees the status through an error that wraps the real one", async () => {
    const wrapped = Object.assign(new Error("screenshot_upload_failed"), {
      cause: httpError(404),
    });
    const { deps } = build({ step: "putImage", error: wrapped });

    const outcome = await uploadHdCopy(source, deps);

    assert.equal(skippedReason(outcome), "rejected");
    assert.equal(failureOf(outcome).status, 404);
  });

  it("never throws, whatever a step throws", async () => {
    for (const error of [null, undefined, "boom", 42, {}]) {
      const { deps } = build({ step: "saveCopy", error });

      const outcome = await uploadHdCopy(source, deps);
      assert.equal(outcome.kind, "retry");
    }
  });
});

describe("reading a status off an error", () => {
  it("finds it on the response, or on a cause, and stops at a cycle", () => {
    assert.equal(getHdCopyErrorStatus(httpError(418)), 418);
    assert.equal(
      getHdCopyErrorStatus({ cause: { cause: httpError(502) } }),
      502
    );

    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    assert.equal(getHdCopyErrorStatus(cycle), undefined);

    assert.equal(getHdCopyErrorStatus(null), undefined);
    assert.equal(getHdCopyErrorStatus(new Error("no response")), undefined);
  });
});

describe("saying which step failed, and why", () => {
  it("names the address the image was being sent to, and only the address", async () => {
    const error = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.9:8788"),
      {
        code: "ECONNREFUSED",
      }
    );
    const { deps } = build({ step: "putImage", error });

    const failure = failureOf(await uploadHdCopy(source, deps));

    assert.deepEqual(failure, {
      stage: "upload",
      message: "connect ECONNREFUSED 10.0.0.9:8788",
      code: "ECONNREFUSED",
      status: undefined,
      target: "https://mine.test",
    });
  });

  it("has no address for a step that comes before one is given", async () => {
    const { deps } = build({
      step: "requestUploadUrl",
      error: new Error("timeout of 30000ms exceeded"),
    });

    const failure = failureOf(await uploadHdCopy(source, deps));

    assert.equal(failure.stage, "upload-url");
    assert.equal(failure.target, undefined);
  });

  it("finds a network code and a status on the error that caused this one", () => {
    const wrapped = Object.assign(new Error("screenshot_upload_failed"), {
      cause: Object.assign(new Error("inner"), { code: "ETIMEDOUT" }),
    });

    assert.equal(describeHdCopyFailure("upload", wrapped).code, "ETIMEDOUT");
    assert.equal(
      describeHdCopyFailure("save", { cause: httpError(409) }).status,
      409
    );
  });

  it("never lets the signed path of the upload address into what it reports", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const error = new Error(
      `getaddrinfo ENOTFOUND for http://mine.test/storage/${token}?x=1 (retrying)`
    );

    const { message } = describeHdCopyFailure("upload", error);

    assert.equal(message.includes(token), false, message);
    assert.match(message, /\/storage\/…/);
    assert.match(message, /ENOTFOUND/);
  });

  it("keeps the message short, and copes with an error that is not one", () => {
    assert.equal(
      describeHdCopyFailure("upload", new Error("x".repeat(5_000))).message
        .length,
      300
    );

    for (const value of [null, undefined, 42, {}, "plain text"]) {
      const failure = describeHdCopyFailure("save", value);
      assert.equal(typeof failure.message, "string");
    }
    assert.equal(
      describeHdCopyFailure("save", "plain text").message,
      "plain text"
    );
  });
});
