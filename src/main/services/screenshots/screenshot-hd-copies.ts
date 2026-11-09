/* 1080p screenshots on the self-hosted server, for accounts with no Hydra Cloud
   subscription.

   Official Hydra keeps every screenshot and, for such an account, only a 720p
   image of it — the 1080p tier is part of the subscription. The self-hosted
   server keeps an extra 1080p copy under the official screenshot's id:

   - after a screenshot is on official Hydra, `attemptHdCopy` uploads the copy;
   - when screenshots are shown, `preferHdScreenshots` swaps the copy in where
     one exists and leaves official's image where it doesn't;
   - when a screenshot is deleted or its visibility changes, the copy follows.

   Official's screenshot is the source of truth throughout, so every path here
   fails open: a copy that is missing, a server that is down, or a lookup that
   times out all just mean the picture official Hydra already has is shown. */

import axios from "axios";
import fs from "node:fs";
import type {
  GameShop,
  LocalScreenshotHdCopy,
  ProfileVisibility,
} from "@types";

import { HydraApi } from "../hydra-api";
import type { HydraApiAuthContext } from "../hydra-auth-context";
import { logger } from "../logger";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { isLocalScreenshotVisibleToOwner } from "./local-screenshot-owner";
import { compressScreenshotForUpload } from "./screenshot-compression";
import {
  applyHdScreenshotCopies,
  collectHdScreenshotRefs,
  getBulkDeletedGame,
  getEditedScreenshotId,
  HD_LOOKUP_BATCH_SIZE,
  HD_SCREENSHOTS_PATH,
  isAwaitingHdCopy,
  isScreenshotReadUrl,
  planHdCopyAfterFailure,
  SCREENSHOT_HD_FEATURE,
} from "./screenshot-hd-copies-core";
import {
  uploadHdCopy,
  type HdCopyUploadDeps,
  type HdCopyFailure,
} from "./screenshot-hd-copy-uploader";

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

/* A report is a courtesy to the server's history; a server that does not
   answer quickly is not waited for. */
const REPORT_TIMEOUT_MS = 5_000;

/* A lookup sits in front of every screenshot page, so a server that is slow or
   down must cost a moment once and not on every page: after a failure the
   lookups stop for a while and official's images are shown meanwhile. */
const LOOKUP_TIMEOUT_MS = 3_000;
const LOOKUP_FAILURE_COOLDOWN_MS = 30_000;

/** Whether the configured server stores these copies at all. */
export const isHdCopyServerAvailable = () =>
  HydraApi.isSelfHostedCloudEnabled() &&
  HydraApi.supportsCloudFeature(SCREENSHOT_HD_FEATURE);

/**
 * Whether this account's screenshots should get a copy: it keeps its storage
 * on the self-hosted server and has no subscription of its own. A real
 * subscriber already gets 1080p from official Hydra.
 */
export const shouldKeepHdCopies = () =>
  isHdCopyServerAvailable() && !HydraApi.hasRealActiveSubscription();

/* `authContext` ties a request to the account that began the work, so one that
   outlives a sign-out or an account switch is refused rather than sent under
   whoever is signed in by then. */
const serverOnly = (timeout: number, authContext?: HydraApiAuthContext) => ({
  forceSelfHostedApi: true as const,
  timeout,
  ...(authContext ? { authContext } : {}),
});

const copyPath = (screenshotId: string) =>
  `${HD_SCREENSHOTS_PATH}/${encodeURIComponent(screenshotId)}`;

const createUploadDeps = (
  authContext: HydraApiAuthContext
): HdCopyUploadDeps => ({
  readOriginal: (path) => fs.promises.readFile(path),
  compress: async (original) => {
    const { image, width, height } = await compressScreenshotForUpload(
      original,
      "CLOUD"
    );
    return { image, width, height };
  },
  requestUploadUrl: (screenshotId, imageLength) =>
    HydraApi.post<{ presignedUrl: string; imageUrl: string }>(
      `${copyPath(screenshotId)}/upload-url`,
      { imageExt: "jpg", imageLength },
      serverOnly(REQUEST_TIMEOUT_MS, authContext)
    ),
  putImage: async (presignedUrl, image) => {
    await axios.put(presignedUrl, image, {
      headers: { "Content-Type": "image/jpeg" },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: UPLOAD_TIMEOUT_MS,
    });
  },
  saveCopy: async (screenshotId, copy) => {
    /* The upload took a while, and the owner may have changed who can see the
       screenshot in it. That change was mirrored to the record at once but
       found no copy to update yet, so the visibility to save is read now. */
    const current = await LocalScreenshotStore.findByScreenshotId(screenshotId);

    await HydraApi.put(
      copyPath(screenshotId),
      { ...copy, visibility: current?.visibility ?? copy.visibility },
      serverOnly(REQUEST_TIMEOUT_MS, authContext)
    );
  },
});

/* Tells the server why a copy did not upload. It can only see an upload that
   reaches it: a launcher that cannot connect to the address it was given, or
   fails before it asks for one, leaves nothing in the server's history unless
   it says so. Best effort, and short: the server being down, or too old to
   take reports, is no reason to fail or hold up anything else. */
const reportHdCopyFailure = async (
  screenshotId: string,
  failure: HdCopyFailure,
  attempts: number,
  willRetry: boolean,
  authContext: HydraApiAuthContext
) => {
  try {
    await HydraApi.post(
      `${copyPath(screenshotId)}/failure`,
      { ...failure, attempts, willRetry },
      serverOnly(REPORT_TIMEOUT_MS, authContext)
    );
  } catch {
    /* The cause is in the launcher's own log either way. */
  }
};

/* Records how an attempt went, but only on the screenshot it was made for and
   only while that screenshot is still waiting for its copy. An attempt takes
   seconds, and in that time the screenshot may have been deleted on official
   Hydra, published again under a new id, or blocked: a record written
   unconditionally afterwards would overwrite what those left. Says whether it
   was written. */
const settleHdCopy = async (
  clientId: string,
  screenshotId: string,
  next: LocalScreenshotHdCopy
) => {
  let written = false;

  await LocalScreenshotStore.update(clientId, (current) => {
    if (!isAwaitingHdCopy(current, screenshotId)) return {};

    written = true;
    return { hdCopy: next };
  });

  return written;
};

/* One attempt at a time per screenshot: the fire-and-forget attempt right after
   an upload and the worker's retry pass can otherwise meet. */
const inFlight = new Set<string>();

/**
 * Uploads the copy for one screenshot, and records on the screenshot how it
 * went. Never throws.
 *
 * A screenshot is marked `pending` when its official upload finishes; this
 * moves it to `uploaded`, back to `pending` with a later time to try again, or
 * to `skipped` when trying again would not help.
 */
export const attemptHdCopy = async (clientId: string) => {
  if (inFlight.has(clientId)) return;
  inFlight.add(clientId);

  try {
    const screenshot = await LocalScreenshotStore.get(clientId);
    if (!screenshot?.screenshotId || screenshot.state !== "uploaded") return;
    if (screenshot.hdCopy?.state !== "pending") return;

    const authContext = HydraApi.getAuthContext();
    if (!authContext || !HydraApi.isLoggedIn()) return;

    /* Another account's screenshot is not this one's to upload. */
    if (!isLocalScreenshotVisibleToOwner(screenshot, authContext.userId)) {
      return;
    }

    const screenshotId = screenshot.screenshotId;

    /* Official's moderation outranks a copy: a blocked screenshot gets none. */
    if (screenshot.moderationStatus === "BLOCKED") {
      await settleHdCopy(clientId, screenshotId, {
        ...screenshot.hdCopy,
        state: "skipped",
        nextAttemptAt: null,
      });
      return;
    }

    /* Left `pending` rather than skipped: the server may come back, or the
       account may be pointed at one that stores copies, and a later pass
       should pick this up then. */
    if (!shouldKeepHdCopies()) return;

    const attempts = screenshot.hdCopy.attempts + 1;
    const outcome = await uploadHdCopy(
      {
        screenshotId,
        path: screenshot.path,
        visibility: screenshot.visibility,
      },
      createUploadDeps(authContext)
    );

    if (outcome.kind === "uploaded") {
      const recorded = await settleHdCopy(clientId, screenshotId, {
        state: "uploaded",
        attempts,
        nextAttemptAt: null,
      });

      /* The screenshot was deleted on official Hydra, or blocked, while this
         was uploading, so the copy was made for something that is gone. */
      if (!recorded) void deleteHdCopy(screenshotId);
      return;
    }

    if (outcome.kind === "skipped") {
      logger.info("Gave up on a 1080p screenshot copy", {
        clientId,
        reason: outcome.reason,
        ...outcome.failure,
      });
      await settleHdCopy(clientId, screenshotId, {
        state: "skipped",
        attempts,
        nextAttemptAt: null,
      });

      /* A capture deleted from disk is the owner's doing, not a fault. */
      if (outcome.reason !== "original_missing") {
        await reportHdCopyFailure(
          screenshotId,
          outcome.failure,
          attempts,
          false,
          authContext
        );
      }
      return;
    }

    logger.warn("Could not upload a 1080p screenshot copy, will retry", {
      clientId,
      attempts,
      ...outcome.failure,
    });
    await settleHdCopy(
      clientId,
      screenshotId,
      planHdCopyAfterFailure(attempts, Date.now())
    );
    await reportHdCopyFailure(
      screenshotId,
      outcome.failure,
      attempts,
      true,
      authContext
    );
  } catch (error) {
    logger.error("A 1080p screenshot copy failed unexpectedly", error);
  } finally {
    inFlight.delete(clientId);
  }
};

/** Retries the copies whose time has come. Called by the upload worker. */
export const retryPendingHdCopies = async (ownerId: string) => {
  if (!shouldKeepHdCopies()) return;

  const now = Date.now();
  const due = (await LocalScreenshotStore.list()).filter(
    (screenshot) =>
      screenshot.ownerId === ownerId &&
      screenshot.state === "uploaded" &&
      screenshot.hdCopy?.state === "pending" &&
      (screenshot.hdCopy.nextAttemptAt ?? 0) <= now
  );

  for (const screenshot of due) await attemptHdCopy(screenshot.clientId);
};

/** When the worker should next wake for a copy, if any is waiting. */
export const getNextHdCopyAttemptAt = (
  screenshots: Array<{
    ownerId: string | null;
    state: string;
    hdCopy?: { state: string; nextAttemptAt: number | null } | null;
  }>,
  ownerId: string,
  now: number
) =>
  screenshots
    .filter(
      (screenshot) =>
        screenshot.ownerId === ownerId &&
        screenshot.state === "uploaded" &&
        screenshot.hdCopy?.state === "pending"
    )
    .map((screenshot) => screenshot.hdCopy?.nextAttemptAt ?? now)
    .toSorted((a, b) => a - b)[0];

let lookupCooldownUntil = 0;

/**
 * Swaps the 1080p copy into a screenshot response, in place, wherever the
 * self-hosted server has one. Always returns `data`: a failure to ask is not a
 * failure to show the screenshot.
 *
 * Nothing is cached. A cached copy would be handed out again after the server
 * went away, which is exactly when the image fails to load and the launcher
 * refetches the screenshot looking for one that works.
 */
export const preferHdScreenshots = async <T>(url: string, data: T) => {
  if (!isScreenshotReadUrl(url)) return data;
  if (!HydraApi.isLoggedIn() || !isHdCopyServerAvailable()) return data;
  if (Date.now() < lookupCooldownUntil) return data;

  const refs = collectHdScreenshotRefs(url, data);
  if (!refs.length) return data;

  try {
    /* No prototype, so no key the server sends can reach one. */
    const copies: Record<string, unknown> = Object.create(null);

    for (let start = 0; start < refs.length; start += HD_LOOKUP_BATCH_SIZE) {
      const response = await HydraApi.post<{
        items?: Record<string, unknown>;
      }>(
        `${HD_SCREENSHOTS_PATH}/lookup`,
        { screenshots: refs.slice(start, start + HD_LOOKUP_BATCH_SIZE) },
        serverOnly(LOOKUP_TIMEOUT_MS)
      );
      Object.assign(copies, response?.items ?? {});
    }

    applyHdScreenshotCopies(data, copies);
  } catch (error) {
    lookupCooldownUntil = Date.now() + LOOKUP_FAILURE_COOLDOWN_MS;
    logger.warn(
      "Could not look up 1080p screenshot copies, showing the official ones",
      error
    );
  }

  return data;
};

/* A screenshot with no copy is the ordinary case, so a 404 here is not news. */
const quietly = (action: string, request: Promise<unknown>) =>
  request.catch((error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    if (status === 404) return;
    logger.warn(`Could not ${action} a 1080p screenshot copy`, error);
  });

/** The official screenshot was deleted; so is its copy. */
export const deleteHdCopy = (screenshotId: string) => {
  if (!isHdCopyServerAvailable()) return Promise.resolve();

  return quietly(
    "delete",
    HydraApi.delete(copyPath(screenshotId), serverOnly(REQUEST_TIMEOUT_MS))
  );
};

/** Official deleted every published screenshot of a game; so go their copies. */
const deleteHdCopiesForGame = async (shop: string, objectId: string) => {
  if (!isHdCopyServerAvailable()) return;

  const screenshots = await LocalScreenshotStore.listForGame(
    shop as GameShop,
    objectId
  );
  for (const screenshot of screenshots) {
    if (screenshot.screenshotId && screenshot.hdCopy) {
      void deleteHdCopy(screenshot.screenshotId);
    }
  }
};

/**
 * The official screenshot's visibility changed; so does its copy's, and the
 * local record's, which a copy still waiting to upload will be made from.
 */
export const mirrorHdCopyVisibility = async (
  screenshotId: string,
  visibility: ProfileVisibility
) => {
  try {
    const local = await LocalScreenshotStore.findByScreenshotId(screenshotId);
    if (local) {
      await LocalScreenshotStore.update(local.clientId, { visibility });
    }

    if (!isHdCopyServerAvailable()) return;

    await quietly(
      "update",
      HydraApi.patch(
        copyPath(screenshotId),
        { visibility },
        serverOnly(REQUEST_TIMEOUT_MS)
      )
    );
  } catch (error) {
    logger.warn("Could not mirror a screenshot's visibility", error);
  }
};

type ApiCallMethod =
  | "get"
  | "getResponse"
  | "post"
  | "postResponse"
  | "put"
  | "patch"
  | "delete";

const isVisibility = (value: unknown): value is ProfileVisibility =>
  value === "PUBLIC" || value === "PRIVATE" || value === "FRIENDS";

const applyScreenshotHooks = async (
  method: ApiCallMethod,
  url: string,
  payload: unknown,
  result: unknown
) => {
  switch (method) {
    case "get":
      return preferHdScreenshots(url, result);
    case "getResponse": {
      const data = (result as { data?: unknown } | null)?.data;
      if (data !== undefined) await preferHdScreenshots(url, data);
      return result;
    }
    case "patch": {
      const screenshotId = getEditedScreenshotId(url);
      const visibility = (payload as { visibility?: unknown } | null)
        ?.visibility;

      if (screenshotId && isVisibility(visibility)) {
        void mirrorHdCopyVisibility(screenshotId, visibility);
      }
      return preferHdScreenshots(url, result);
    }
    case "delete": {
      const screenshotId = getEditedScreenshotId(url);
      if (screenshotId) void deleteHdCopy(screenshotId);

      /* Deleting a game's published screenshots in one call names none of
         them. The launcher's records still know which they were: this runs
         before they are cleaned up, which happens after official has answered. */
      const game = getBulkDeletedGame(url);
      if (game) await deleteHdCopiesForGame(game.shop, game.objectId);
      return result;
    }
    default:
      return result;
  }
};

/**
 * What the launcher's API bridge does with a screenshot call's result: shows
 * the 1080p copy where there is one, and makes a delete or visibility change
 * reach the copy.
 *
 * Done here, once, because the desktop UI and Big Picture both read and edit
 * screenshots through the same bridge, so neither needs to know copies exist.
 *
 * This runs after every call the UI makes, and official Hydra has already
 * answered by then, so nothing here may turn that answer into an error: on any
 * failure the result is returned as it came.
 */
export const afterScreenshotApiCall = async (
  method: ApiCallMethod,
  url: string,
  payload: unknown,
  result: unknown
) => {
  try {
    return await applyScreenshotHooks(method, url, payload, result);
  } catch (error) {
    logger.warn("Could not apply 1080p screenshot copies", error);
    return result;
  }
};
