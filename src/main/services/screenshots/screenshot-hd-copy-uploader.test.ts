import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getHdCopyErrorStatus,
  uploadHdCopy,
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

    assert.deepEqual(await uploadHdCopy(source, deps), {
      kind: "skipped",
      reason: "original_missing",
    });
    assert.deepEqual(calls, ["readOriginal"]);
  });

  it("tries a capture again whose read failed for another reason", async () => {
    const error = fsError("EBUSY");
    const { deps } = build({ step: "readOriginal", error });

    assert.deepEqual(await uploadHdCopy(source, deps), {
      kind: "retry",
      error,
    });
  });

  it("gives up on a capture that cannot be compressed, since it never will", async () => {
    const { deps, calls } = build({
      step: "compress",
      error: new Error("screenshot_unreadable"),
    });

    assert.deepEqual(await uploadHdCopy(source, deps), {
      kind: "skipped",
      reason: "unreadable",
    });
    assert.deepEqual(calls, ["readOriginal", "compress"]);
  });

  for (const step of ["requestUploadUrl", "putImage", "saveCopy"] as const) {
    it(`tries again when ${step} cannot reach the server`, async () => {
      const error = new Error("socket hang up");
      const { deps } = build({ step, error });

      assert.deepEqual(await uploadHdCopy(source, deps), {
        kind: "retry",
        error,
      });
    });

    it(`tries again when ${step} meets a server error`, async () => {
      const { deps } = build({ step, error: httpError(503) });

      assert.equal((await uploadHdCopy(source, deps)).kind, "retry");
    });

    it(`gives up when ${step} is refused for good`, async () => {
      const { deps } = build({ step, error: httpError(404) });

      assert.deepEqual(await uploadHdCopy(source, deps), {
        kind: "skipped",
        reason: "rejected",
      });
    });
  }

  it("treats a quota refusal as final for this screenshot", async () => {
    const { deps } = build({ step: "requestUploadUrl", error: httpError(413) });

    assert.deepEqual(await uploadHdCopy(source, deps), {
      kind: "skipped",
      reason: "rejected",
    });
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

    assert.deepEqual(await uploadHdCopy(source, deps), {
      kind: "skipped",
      reason: "rejected",
    });
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
