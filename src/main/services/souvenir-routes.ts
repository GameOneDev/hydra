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
