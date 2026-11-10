/* Uploads one 1080p copy of an already-uploaded screenshot to the self-hosted
   server. Everything that touches the network or the disk is passed in, so the
   flow and its failure handling run in tests without either.

   The copy is a nicety on top of a screenshot official Hydra already has, so
   this never throws: it says what happened, and the caller decides whether to
   try again. */

import type { ProfileVisibility } from "@types";

import { isRetryableHdCopyStatus } from "./screenshot-hd-copies-core.js";

export interface HdCopySource {
  /** The official Hydra id the copy is attached to. */
  screenshotId: string;
  /** The original capture on disk, which the copy is made from. */
  path: string;
  visibility: ProfileVisibility;
}

export interface HdCopyUploadDeps {
  readOriginal: (path: string) => Promise<Buffer>;
  /** The 1080p tier of the same compression the official upload uses. */
  compress: (
    original: Buffer
  ) => Promise<{ image: Buffer; width: number; height: number }>;
  requestUploadUrl: (
    screenshotId: string,
    imageLength: number
  ) => Promise<{ presignedUrl: string; imageUrl: string }>;
  putImage: (presignedUrl: string, image: Buffer) => Promise<void>;
  saveCopy: (
    screenshotId: string,
    copy: {
      imageUrl: string;
      width: number;
      height: number;
      visibility: ProfileVisibility;
    }
  ) => Promise<void>;
}

/**
 * Why a copy was given up on rather than retried.
 *
 * - `original_missing`: the capture was deleted from disk, so there is nothing
 *   to make a copy from.
 * - `unreadable`: the capture can't be decoded or won't fit the size cap; it
 *   would fail the same way every time.
 * - `rejected`: the server answered with a refusal retrying cannot change —
 *   a full quota, a server too old to have the endpoint.
 */
export type HdCopySkipReason = "original_missing" | "unreadable" | "rejected";

/**
 * The steps of an upload, in the order they run. A failure names the one it
 * stopped at, because "could not upload" does not say whether the screenshot
 * could not be read, the server could not be asked, or the image could not be
 * sent to the address it gave.
 */
export type HdCopyStage =
  | "read"
  | "compress"
  | "upload-url"
  | "upload"
  | "save";

/** What went wrong, in a form that is safe to log and to send to the server. */
export interface HdCopyFailure {
  stage: HdCopyStage;
  message: string;
  /** A network error code such as `ECONNREFUSED`. */
  code?: string;
  /** The HTTP status of an answer, when there was one. */
  status?: number;
  /** Where the image was being sent: the address, never the signed path. */
  target?: string;
}

export type HdCopyOutcome =
  | { kind: "uploaded" }
  | { kind: "skipped"; reason: HdCopySkipReason; failure: HdCopyFailure }
  | { kind: "retry"; error: unknown; failure: HdCopyFailure };

/* An HTTP status from whatever a request threw: the response of an axios
   error, possibly wrapped as the `cause` of an error that names the step. */
export const getHdCopyErrorStatus = (
  error: unknown,
  depth = 0
): number | undefined => {
  if (typeof error !== "object" || error === null || depth > 4) {
    return undefined;
  }

  const response = (error as { response?: { status?: unknown } }).response;
  if (typeof response?.status === "number") return response.status;

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined || cause === error
    ? undefined
    : getHdCopyErrorStatus(cause, depth + 1);
};

const MAX_FAILURE_MESSAGE = 300;

/* An error's own network code, found through the errors that wrap it. */
const getErrorCode = (error: unknown, depth = 0): string | undefined => {
  if (typeof error !== "object" || error === null || depth > 4) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code) return code;

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined || cause === error
    ? undefined
    : getErrorCode(cause, depth + 1);
};

/* The upload address carries a signed token in its path. Whatever an error
   says about it is cut down to the part that does not. */
const withoutSignedPath = (text: string) =>
  text.replace(/\/storage\/[^\s"'<>)]+/g, "/storage/…");

/* A file's path says where on the user's disk it is, and what they call their
   folders. It belongs in their own log; it does not belong in a report sent
   to a server. */
const LOCAL_PATH = /(?:[A-Za-z]:\\|\/)[^\s'"<>)]*[\\/][^\s'"<>)]*/g;

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/** Turns whatever a step threw into something a person can read. */
export const describeHdCopyFailure = (
  stage: HdCopyStage,
  error: unknown,
  target?: string
): HdCopyFailure => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return {
    stage,
    message: (stage === "read" || stage === "compress"
      ? raw.replace(LOCAL_PATH, "<path>")
      : withoutSignedPath(raw)
    ).slice(0, MAX_FAILURE_MESSAGE),
    code: getErrorCode(error),
    status: getHdCopyErrorStatus(error),
    target,
  };
};

const isMissingFile = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "ENOENT";

export const uploadHdCopy = async (
  source: HdCopySource,
  deps: HdCopyUploadDeps
): Promise<HdCopyOutcome> => {
  let original: Buffer;
  try {
    original = await deps.readOriginal(source.path);
  } catch (error) {
    const failure = describeHdCopyFailure("read", error);

    return isMissingFile(error)
      ? {
          kind: "skipped",
          reason: "original_missing",
          failure: { ...failure, message: "the screenshot file is gone" },
        }
      : { kind: "retry", error, failure };
  }

  /* Compression is deterministic: a file that fails here fails every time. */
  let compressed: Awaited<ReturnType<HdCopyUploadDeps["compress"]>>;
  try {
    compressed = await deps.compress(original);
  } catch (error) {
    return {
      kind: "skipped",
      reason: "unreadable",
      failure: describeHdCopyFailure("compress", error),
    };
  }

  let stage: HdCopyStage = "upload-url";
  let target: string | undefined;

  try {
    const slot = await deps.requestUploadUrl(
      source.screenshotId,
      compressed.image.byteLength
    );

    stage = "upload";
    target = originOf(slot.presignedUrl);
    await deps.putImage(slot.presignedUrl, compressed.image);

    stage = "save";
    await deps.saveCopy(source.screenshotId, {
      imageUrl: slot.imageUrl,
      width: compressed.width,
      height: compressed.height,
      visibility: source.visibility,
    });

    return { kind: "uploaded" };
  } catch (error) {
    const failure = describeHdCopyFailure(stage, error, target);

    return isRetryableHdCopyStatus(getHdCopyErrorStatus(error))
      ? { kind: "retry", error, failure }
      : { kind: "skipped", reason: "rejected", failure };
  }
};
