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

export type HdCopyOutcome =
  | { kind: "uploaded" }
  | { kind: "skipped"; reason: HdCopySkipReason }
  | { kind: "retry"; error: unknown };

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
    return isMissingFile(error)
      ? { kind: "skipped", reason: "original_missing" }
      : { kind: "retry", error };
  }

  /* Compression is deterministic: a file that fails here fails every time. */
  let compressed: Awaited<ReturnType<HdCopyUploadDeps["compress"]>>;
  try {
    compressed = await deps.compress(original);
  } catch {
    return { kind: "skipped", reason: "unreadable" };
  }

  try {
    const slot = await deps.requestUploadUrl(
      source.screenshotId,
      compressed.image.byteLength
    );
    await deps.putImage(slot.presignedUrl, compressed.image);
    await deps.saveCopy(source.screenshotId, {
      imageUrl: slot.imageUrl,
      width: compressed.width,
      height: compressed.height,
      visibility: source.visibility,
    });

    return { kind: "uploaded" };
  } catch (error) {
    return isRetryableHdCopyStatus(getHdCopyErrorStatus(error))
      ? { kind: "retry", error }
      : { kind: "skipped", reason: "rejected" };
  }
};
