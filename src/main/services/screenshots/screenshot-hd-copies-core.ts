/* Pure parts of the self-hosted 1080p screenshot copies: which API responses
   carry screenshots, which of their items a copy may replace, and when a failed
   upload is tried again. Nothing here touches the network or the disk, so it
   can be tested without either.

   The model: official Hydra owns every screenshot and keeps a 720p image for an
   account with no subscription. The self-hosted server keeps an extra 1080p
   copy under the official screenshot's id. Showing a screenshot swaps that copy
   in for official's image where one exists. */

import type { LocalScreenshotHdCopy } from "@types";

/** What a self-hosted server advertises once it stores these copies. */
export const SCREENSHOT_HD_FEATURE = "screenshots-hd";

/** Routed to the self-hosted server as a whole; official Hydra has no such path. */
export const HD_SCREENSHOTS_PATH = "/profile/hd-screenshots";

/** What the server accepts in one lookup. */
export const HD_LOOKUP_BATCH_SIZE = 100;

export interface HdScreenshotRef {
  userId: string;
  id: string;
}

export interface HdScreenshotCopy {
  url: string;
  width: number;
  height: number;
}

type Item = Record<string, unknown>;

/* The responses that list or return screenshots. The `games` summary and the
   comment routes under a screenshot are deliberately left out: they carry no
   screenshot images, and the anchors keep them from matching. */
const SCREENSHOT_READ_URL_PATTERNS = [
  /^\/users\/([^/?]+)\/screenshots(?:\/(?!games(?:\?|$))[^/?]+)?(?:\?|$)/,
  /^\/games\/[^/?]+\/[^/?]+\/screenshots(?:\?|$)/,
  /^\/profile\/screenshots(?:\/[^/?]+)?(?:\?|$)/,
];

export const isScreenshotReadUrl = (url: string) =>
  SCREENSHOT_READ_URL_PATTERNS.some((pattern) => pattern.test(url));

/** The profile a `/users/{id}/screenshots…` request is about, if it is one. */
const profileOwnerOf = (url: string) => {
  const match = SCREENSHOT_READ_URL_PATTERNS[0].exec(url);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

/** `/profile/screenshots/{id}` exactly — what an edit or a delete is sent to. */
export const getEditedScreenshotId = (url: string) => {
  const match = /^\/profile\/screenshots\/([^/?]+)$/.exec(url);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Item =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/* A listing is `{ items }`, a single screenshot is the object itself. */
const itemsOf = (data: unknown): Item[] => {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  if (Array.isArray(data.items)) return data.items.filter(isRecord);
  return [data];
};

/**
 * Whether a copy may replace this item's image.
 *
 * Only where official Hydra itself returned an image, and never for a
 * screenshot it blocked. That is what keeps a copy from showing what official
 * withheld: a screenshot with no `imageUrl` stays without one.
 */
const canTakeCopy = (item: Item) =>
  typeof item.id === "string" &&
  item.id !== "" &&
  typeof item.imageUrl === "string" &&
  item.imageUrl !== "" &&
  item.moderationStatus !== "BLOCKED";

const ownerOf = (item: Item, fallback: string | null) => {
  const owner = item.owner;
  if (isRecord(owner) && typeof owner.id === "string" && owner.id !== "") {
    return owner.id;
  }
  return fallback;
};

/** The screenshots in `data` worth asking the self-hosted server about. */
export const collectHdScreenshotRefs = (
  url: string,
  data: unknown
): HdScreenshotRef[] => {
  const fallbackOwner = profileOwnerOf(url);
  const seen = new Set<string>();
  const refs: HdScreenshotRef[] = [];

  for (const item of itemsOf(data)) {
    if (!canTakeCopy(item)) continue;

    const userId = ownerOf(item, fallbackOwner);
    if (!userId) continue;

    const id = item.id as string;
    const key = `${userId}\u0000${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ userId, id });
  }

  return refs;
};

const isCopy = (value: unknown): value is HdScreenshotCopy =>
  isRecord(value) &&
  typeof value.url === "string" &&
  value.url !== "" &&
  typeof value.width === "number" &&
  typeof value.height === "number";

/**
 * Puts the copies into `data`, in place, and returns how many it replaced.
 *
 * The image and its size are replaced together, since the lightbox lays the
 * picture out from its dimensions. The thumbnail stays official's: it is
 * already small, and a copy is only ever the big picture.
 */
export const applyHdScreenshotCopies = (
  data: unknown,
  copies: Record<string, unknown>
) => {
  let replaced = 0;

  for (const item of itemsOf(data)) {
    if (!canTakeCopy(item)) continue;

    const copy = copies[item.id as string];
    if (!isCopy(copy)) continue;

    item.imageUrl = copy.url;
    item.width = copy.width;
    item.height = copy.height;
    replaced++;
  }

  return replaced;
};

/* How long to wait after the nth failed attempt. Long on purpose: a server that
   is down for a morning should not be hammered by every screenshot taken in
   it, and the copy is a nicety, not the screenshot. */
export const HD_COPY_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
];

/** Where a copy stands after one more failed attempt, `attempts` counting it. */
export const planHdCopyAfterFailure = (
  attempts: number,
  now: number
): LocalScreenshotHdCopy => {
  const delay = HD_COPY_RETRY_DELAYS_MS[attempts - 1];

  /* Out of delays means out of patience: stop rather than retry forever. */
  if (delay === undefined) {
    return { state: "skipped", attempts, nextAttemptAt: null };
  }

  return { state: "pending", attempts, nextAttemptAt: now + delay };
};

/** Statuses worth another attempt; any other 4xx will answer the same way. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

export const isRetryableHdCopyStatus = (status: number | undefined) =>
  status === undefined || status >= 500 || RETRYABLE_STATUSES.has(status);
