/* Feature string the self-hosted server advertises at /capabilities when it
   implements the souvenir endpoints. */
export const ACHIEVEMENT_SOUVENIRS_FEATURE = "souvenirs";

/* Achievement souvenirs (upstream hydralauncher/hydra#2700). The screenshot
   upload is not flagged needsSubscription — upstream authorizes it before it
   knows whether the capture will be kept — so it has to be routed by path. */
const SOUVENIR_ROUTED_PREFIXES = [
  "/presigned-urls/achievement-image",
  /* Also covers "/profile/souvenirs-visibility", the account-level setting
     this fork mirrors to the self-hosted server. */
  "/profile/souvenirs",
];

/* The reads hang off "/users/{id}", which is otherwise the official API's
   profile namespace, so they are matched by shape rather than prefix.
   "/users/{id}/games/achievements" is where the launcher reads the souvenir
   taken for each unlock; the trailing anchor keeps
   ".../achievements/compare" — which only the official API answers — off it. */
const SOUVENIR_ROUTED_PATTERNS = [
  /^\/users\/[^/]+\/souvenirs(\/|\?|$)/,
  /^\/users\/[^/]+\/games\/achievements(\?|$)/,
];

/**
 * Whether a request belongs to the souvenir feature, and so should go to the
 * cloud server that stores souvenirs rather than to the official API.
 */
export const isSouvenirRoute = (url: string) =>
  SOUVENIR_ROUTED_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
  SOUVENIR_ROUTED_PATTERNS.some((pattern) => pattern.test(url));
