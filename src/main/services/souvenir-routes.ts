/* What the self-hosted server advertises at /capabilities once it implements
   the souvenir endpoints. */
export const ACHIEVEMENT_SOUVENIRS_FEATURE = "souvenirs";

/* Upstream authorizes the screenshot upload before it knows whether the
   capture will be kept, so it carries no needsSubscription flag and has to be
   routed by path. "/profile/souvenirs" also covers the account-level
   "-visibility" setting. */
const SOUVENIR_ROUTED_PREFIXES = [
  "/presigned-urls/achievement-image",
  "/profile/souvenirs",
];

/* The reads hang off "/users/{id}", otherwise the official API's profile
   namespace, so they match by shape. The trailing anchor keeps
   ".../achievements/compare" — official-only — off the second one. */
const SOUVENIR_ROUTED_PATTERNS = [
  /^\/users\/[^/]+\/souvenirs(\/|\?|$)/,
  /^\/users\/[^/]+\/games\/achievements(\?|$)/,
];

/** Whether a request belongs to the souvenir feature. */
export const isSouvenirRoute = (url: string) =>
  SOUVENIR_ROUTED_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
  SOUVENIR_ROUTED_PATTERNS.some((pattern) => pattern.test(url));

/* Which server answered for a given profile's souvenirs. Souvenirs live
   wherever their owner captured them, so a profile on official Hydra has to be
   read there — and its likes and reports have to follow, or they land on a
   server that has never heard of the souvenir. */
type SouvenirSource = "cloud" | "official";

const sourceByProfile = new Map<string, SouvenirSource>();

export const rememberSouvenirSource = (
  userId: string,
  source: SouvenirSource
) => {
  sourceByProfile.set(userId, source);
};

export const forgetSouvenirSources = () => {
  sourceByProfile.clear();
};

const profileOf = (url: string) =>
  /^\/users\/([^/?]+)\//.exec(url)?.[1] ??
  /^\/users\/([^/?]+)(\?|$)/.exec(url)?.[1];

/**
 * Whether this souvenir request belongs to a profile last served by official
 * Hydra. Unknown profiles answer false: the self-hosted server is asked first
 * and is the one that reports whether it knows them.
 */
export const isOfficialSouvenirProfile = (url: string) => {
  const userId = profileOf(url);
  return userId
    ? sourceByProfile.get(decodeURIComponent(userId)) === "official"
    : false;
};
