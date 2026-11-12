# The self-hosted patch: what the fork changed, and what to re-check after a merge

The fork is upstream Hydra plus a layer that lets a launcher use a self-hosted
server (`GameOneDev/hydra-server`) in place of Hydra Cloud. Upstream knows
nothing about it, so every upstream release can quietly route around it. This
file says where the layer is. Verify it with the commands at the bottom rather
than trusting it: it is a map, and maps age.

## The idea in four sentences

1. `HydraApi.resolveInstance` (`src/main/services/hydra-api.ts`) picks, per
   request, official Hydra or the self-hosted server.
2. With a server configured, `hasActiveSubscription()` is **always true**, so
   every upstream "is the user a subscriber?" check passes. `hasRealActiveSubscription()`
   is the account's real subscription.
3. `supportsCloudFeature("slug")` asks the server's `/capabilities` whether it
   can do something, and **fails closed** (unknown or unreachable means no).
4. Social and catalogue features stay on official Hydra. Storage that a Hydra
   Cloud subscription unlocks is what the server stands in for.

## Routing (hydra-api.ts, read by `scripts/api_surface.py`)

| Table | Meaning |
| --- | --- |
| `CLOUD_ROUTED_PREFIXES` | Always answered by the self-hosted server. Includes `/profile/games/artifacts`, `/profile/games/artwork`, `/profile/emulation-saves`, `/profile/download-sources`, `/profile/hidden-games`, `/profile/banner`, `/profile/stats`, `/profile/achievements`, `/profile/playtime`, `/profile/members`, `/profile/hd-screenshots`. |
| `CLOUD_FALLBACK_PREFIXES` | Routed there only when the account has no real subscription (banner uploads). |
| `OFFICIAL_ONLY_PREFIXES` | Held on official even when the call carries `needsSubscription` (`/hosters/`, `/profile/achievements/combined`). |
| `SELF_HOSTED_ONLY_PREFIXES` | Paths official has no answer to; with no server configured they **fail** instead of falling back to official (`/profile/hd-screenshots`). |
| `src/main/services/souvenir-routes.ts` | Souvenirs route by shape (`/users/{id}/souvenirs`, `/users/{id}/games/achievements`) and only when the server advertises `souvenirs`. |
| `needsSubscription: true` on a call | Routed to the server unless it matches `OFFICIAL_ONLY_PREFIXES`. |
| `forceSelfHostedApi`, `forceOfficialApi` | Per-call overrides, main process only. `forceSelfHostedApi` with no server configured throws. |

A new upstream feature that is **storage a subscription unlocks** belongs in
`CLOUD_ROUTED_PREFIXES` (and on the server). A new subscriber-only service that
only official Hydra can perform belongs in `OFFICIAL_ONLY_PREFIXES`. Anything
else stays on official by default, which is correct for most of what upstream
adds (chat, missions, leaderboards, recompilation catalogue, library, profile).

## Patch points that upstream rewrites (re-check every merge)

These are where a text merge succeeded and the feature quietly stopped working.

| Where | What the fork does | What goes wrong |
| --- | --- | --- |
| Souvenir capture gates: `load-emulator-achievement-tracking.ts`, `merge-achievements.ts`, `update-user-preferences.ts`, `linux-game-capture-session.ts` | Gate on `HydraApi.supportsAchievementSouvenirs()` (subscription **and** server capability) | Upstream puts a plain `hasActiveSubscription()` back (it did in 4.4.1 in `prepare-emulator-souvenirs.ts`); always true, so capture runs against a server with no endpoints and the retry queue fills |
| `combined-achievements-requests.ts`, `get-unlocked-achievements.ts` | Backoff **per server**, self-hosted fallback only after official comes back empty | A shared backoff lets an official failure silence the fallback for up to 30 minutes |
| `screenshot-upload-worker.ts` | Quality follows `hasRealActiveSubscription()` | Upstream asks official for `CLOUD` quality and is refused first |
| `achievement-unlock-notifications.ts` | Collapses an oversized batch into one notification | Upstream's rewrite drops it |
| `src/main/main.ts`, `src/main/index.ts` | Flat startup order; split state load; `setupApi()` once | The most conflicted files. Keep upstream's ordering fixes and the fork's sequence |
| `user-profile.context.tsx` | Profile set only after the self-hosted banner and artwork lookups finish | Upstream's stale-user guard has to be applied after those awaits |
| `automatic-sync-mode.ts`, `automatic-sync-settings.ts`, `get-cloud-save-v2-supported.ts` | Capability list per shop and object id (`cloud-saves-v2`, `-epic`, `-recompilation`) | Both sides add parameters; keep the fork's order |
| `hydra-api-call.ts` + `screenshot-hd-copies.ts` | The bridge hook that swaps in the self-hosted 1080p copy and mirrors deletes | A new screenshot endpoint the hook does not know about |
| `electron-builder.yml` | `electronFuses.resetAdHocDarwinSignature: true`, `mac.extendInfo` as a **map** | Upstream edits the same block; losing the first crashes macOS arm64 at launch ("Code Signature Invalid"). `scripts/electron-builder-config.test.mjs` pins both |
| `.github/workflows/release.yml`, `build.yml` | The fork's Windows ARM build step and artifact settings | Conflicts on every merge |

Fork-only files (new, so they cannot conflict, but check they still compile):
`self-hosted-hidden-games.ts`, `self-hosted-game-links.ts`,
`settings-self-hosted.tsx`, `self-hosted-status-indicator.tsx`,
`self-hosted-artwork*.ts`, `settings-context-cloud-saves.tsx`,
`src/shared/self-hosted-url.ts`, `src/types/self-hosted.types.ts`,
`src/shared/souvenirs.ts`, `screenshot-hd-copies*.ts`.

## What stays on official Hydra (so a new one is not a server task)

Chat and official messages, missions / trails / progress (gamification), the
recompilation catalogue and install, leaderboards, library and profile
listings, comments and likes, the catalogue, and hoster unlocking. A feature
flag from the official API (`GAMIFICATION`, `GLOBAL_LEADERBOARDS`, ...) is
official's own, not a server capability.

## Verify this map

```bash
# the patch's own surface, as a diff against the last upstream release in main
git diff <last merged upstream tag> origin/main --stat -- src scripts .github
# every place the fork's layer is called
git grep -n -E 'isSelfHostedCloudEnabled|supportsCloudFeature|hasRealActiveSubscription|forceSelfHostedApi|supportsAchievementSouvenirs' -- src
# every subscription gate in upstream's code: each is a decision with a self-hosted server
git grep -n -E 'hasActiveSubscription\(|needsSubscription' -- src
# the routing tables
sed -n '/CLOUD_ROUTED_PREFIXES =/,/^  \];/p' src/main/services/hydra-api.ts
```

When a merge adds, moves or removes a patch point, update this file in the same
change.
