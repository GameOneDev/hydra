---
name: merge-upstream-hydra
description: Merge a new upstream Hydra launcher release (hydralauncher/hydra) into the self-hosted fork, and find which Hydra Cloud changes in it need porting to the hydra-server repo. Use when upstream has a new tag or release, when asked to update, sync or merge from upstream, or to check a Hydra update for cloud, subscription or self-hosted impact.
argument-hint: "[upstream tag, e.g. v4.5.0]"
---

# Merge an upstream Hydra release into the self-hosted fork

Target release: `$ARGUMENTS` (if empty, step 0 finds the newest upstream tag not yet merged).

This repo is a fork of `hydralauncher/hydra` (remote `upstream`) with a layer that lets the
launcher use a self-hosted server, `GameOneDev/hydra-server`, in place of Hydra Cloud
(remote `origin` is the fork). The server is a sibling checkout, `../hydra-server`; in a
cloud session without it, attach it with the `add_repo` tool.

A merge here is three jobs, and the second is the one that gets missed:

1. **Merge safely.** The fork's history is criss-crossed and upstream rewrites code the
   fork patched.
2. **Find the Hydra Cloud changes the server has to answer.** Upstream only talks to
   *official* Hydra, so the server only ever sees what the fork routes to it, and a
   change to a request that already goes there (a new field, a new key form) does not
   show up as a new endpoint.
3. **Port them**, server first.

A merge that compiles can still break every self-hosted user: with a server configured,
`hasActiveSubscription()` is always true, so an upstream subscription check that comes
back in a rewrite passes silently. Read `reference/self-hosted-patch.md` before step 3.

## Rules

- **Merge commit only.** Never squash or rebase the merge PR (it drops the ancestry and
  brings the spurious conflicts back next release). Never `git stash` during a merge: it
  drops `MERGE_HEAD`. Never use `-X ours` / `-X theirs`: they resolve silently.
- **Do the read-only analysis (step 2) before merging.**
- **Branches and PRs follow the session's instructions.** Push only to the designated
  branch; open a PR only when the user asks; a branch whose PR was merged is restarted
  from `origin/main`.
- **Say what was not verified.** The app cannot be launched, and native and macOS
  builds do not run, in a cloud session. Report that as a fact in the handoff.

## 0. Orient

```bash
git remote -v                                   # origin = the fork, upstream = hydralauncher/hydra
git fetch origin main && git fetch upstream --tags
SEMVER='^v[0-9]+\.[0-9]+\.[0-9]+$'               # upstream has stray tags (v.2.1.5, v1.0.0+steamdb-rotation)
OLD=$(git tag -l --merged origin/main | grep -E "$SEMVER" | sort -V | tail -1)   # the release the fork has
git tag -l | grep -E "$SEMVER" | sort -V | awk -v o="$OLD" 'f{print} $0==o{f=1}'  # releases after it
NEW=${ARGUMENTS:-<the newest of those>}
git rev-list --count $OLD..$NEW; git diff --shortstat $OLD $NEW
git log --merges --format=%s $OLD..$NEW | grep 'Merge pull request'   # the changelog
git -C ../hydra-server log -1 --format='%h %s' origin/main            # the server's state
```

An upstream tag is not always an ancestor of the fork's `main` even when its content is in
(`v4.3.0` is a merge commit on upstream's release branch, so `--no-merged` lists it as
missing). Take the highest strict-semver tag that *is* an ancestor as OLD, as above, and
do not trust `--no-merged` on its own.

Tell the user OLD, NEW, the size, and the changelog items that mention cloud,
subscription, screenshots, saves, achievements, souvenirs or profile. If the user pasted
a changelog, use it. Fetch `origin main` on its own: an explicit ref that no longer
exists (a merged branch) makes the whole fetch fail and leaves a stale `origin/main`.

## 1. Preview the merge (changes nothing)

```bash
git merge-base --all origin/main $NEW           # one base = easy; several = criss-cross
git merge-tree --write-tree --name-only origin/main $NEW   # exit 0 clean, 1 conflicts
```

- **One merge base** (normally OLD itself): merge `$NEW` into a branch made from
  `origin/main`. Expect a handful of conflicts (4.4.0 had four; 4.4.1 would have eight).
- **Several bases, or a conflict count in the hundreds:** git picked a bad base. Try each
  candidate with `git merge-tree --write-tree --name-only --merge-base=<c> origin/main $NEW`
  and take the upstream commit with the fewest conflicts (for 4.3.0, git's own base gave
  about 100 conflicts and the last upstream commit before the changelog, `1b900e1`, gave 25).
  Then merge with that base explicitly (step 3).

## 2. Hydra Cloud analysis, before merging

```bash
python3 -I .claude/skills/merge-upstream-hydra/scripts/api_surface.py \
    --old OLD --new $NEW --server ../hydra-server --server-rev origin/main
```

It reads the fork's own routing tables (`reference/self-hosted-patch.md`), classifies every
endpoint upstream's code calls the way the fork would route it, and checks the server's
real routes and capabilities. The summary is first. How to act on each section:

| Finding | What it means | Do |
| --- | --- | --- |
| New endpoint, **SELF-HOSTED**, "NO ROUTE" | The launcher will send it to a server that cannot answer | Port it (step 6) |
| New endpoint, **SELF-HOSTED**, server has a route | Check the request and response shape, not just the path | Read the call and the handler |
| New endpoint, **OFFICIAL** | Stays on official Hydra; nothing for the server | Confirm it is really official-only. A storage feature a subscription unlocks should be routed: add the prefix and port it |
| New `needsSubscription: true` call | Routed to the server automatically unless held in `OFFICIAL_ONLY_PREFIXES` | Port it, or add the prefix to `OFFICIAL_ONLY_PREFIXES` if only official can do it |
| New `hasActiveSubscription()` check | Always true with a server | Decide: `hasRealActiveSubscription()` (feature exists only on official), `supportsCloudFeature(slug)` (server provides it), or `supportsAchievementSouvenirs()` for souvenirs |
| **Modified** contract file (section 4) | The shape of a request or response may have changed under an unchanged route | **Read the diff.** New payload fields, new `shop` or object-id forms, new validator rules (`cloud-save-contract.ts` rejects unknown keys). If an older server cannot safely ignore it, add a capability and gate on it |
| Capability the fork requires, server lacks | The launcher would never enable the feature | Advertise it from the server |
| Calls it could not classify (section 7) | The path is built by a helper | Read each one |

Also read the changelog yourself for: premium or "cloud" wording, quality tiers (the 1080p
screenshot tier is subscription-gated), subscriber-only bonuses, and official feature
flags (`GAMIFICATION`, `GLOBAL_LEADERBOARDS`: official's own, not server capabilities).

Write the result down as three short lists: **port**, **official, nothing to do**, **needs
a decision**. It becomes the handoff and the PR description. If a decision is the user's
(route a new feature to the server or not), ask before merging, not after.

## 3. Merge

**One merge base** (the normal case):

```bash
git checkout -b <branch per the session's rules> origin/main
git merge --no-ff -m "Merge upstream $NEW into the self-hosted fork" $NEW
```

**A bad base** (step 1 found several, or hundreds of conflicts). `git merge` cannot take a
base, so do the three-way merge with plumbing and then make the commit a real merge. This
was tested on the 4.3.0 merge: git's base gave 70+ conflicted files, the explicit base 25
content conflicts and one delete.

```bash
git checkout -b <branch> origin/main
git read-tree -m -u <BASE> HEAD $NEW        # three-way, with YOUR base; needs a clean tree
git merge-index -o git-merge-one-file -a    # -o: carry on past conflicts; it lists them
git ls-files -u | cut -f2 | sort -u         # the files still conflicted
#  resolve each, then `git add <file>`; a file one side deleted: `git rm -f <file>`
GD=$(git rev-parse --git-dir)
git rev-parse $NEW > "$GD/MERGE_HEAD"       # so the commit has two parents
echo "Merge upstream $NEW into the self-hosted fork" > "$GD/MERGE_MSG"
git commit -F "$GD/MERGE_MSG"
git log -1 --format=%P                      # two hashes; `git merge-base --is-ancestor $NEW HEAD` is true
```

In the conflict markers the first side is the fork's and the second is upstream's; the
labels are temporary file names, not branch names. A commit with one parent is not a
merge: do not push it.

Resolve each conflict by understanding both sides: why the fork changed it
(`git log -S'<line>' origin/main -- <file>`) and what upstream changed (its PR title in
the changelog). Keep both intents. The usual conflict files are listed in
`reference/self-hosted-patch.md`. Before committing, `git diff --check` and
`git grep -n -E '^(<<<<<<<|>>>>>>>)'` find nothing.

Do not hand-edit a conflict you do not understand to make it compile. A text merge hides
compile errors (a dropped declaration, a duplicate import), which step 5 finds.

## 4. Re-apply the self-hosted patch where upstream rewrote it

```bash
python3 -I .claude/skills/merge-upstream-hydra/scripts/merge_integrity.py \
    --upstream $NEW --main origin/main --head HEAD [--base <the explicit base from step 1>] \
    [--known-edit <file> ...]
```

It classifies every file by who changed it since the common base. Read the output in this order:

1. **VIOLATIONS**: a file only upstream changed that no longer matches upstream's, or
   one only the fork changed that no longer matches the fork's. Each is either a patch
   point re-applied on purpose (name it with `--known-edit` once you have checked it)
   or a mistake. The goal is zero unexplained.
2. **TOOK UPSTREAM'S VERSION of a file the fork also changed**: the fork's change is gone
   from that file. Confirm it was re-applied at the callers, or is obsolete.
3. **SELF-HOSTED MARKERS that went down**: calls into the fork's layer that vanished. This
   is the check that catches a patch point a clean-looking merge dropped.
4. **REAL MERGES**: the review surface; skim the ones in the map.

Re-apply by meaning, not by text: if upstream moved a gate to another function, put the
fork's gate there. Add a test when the behaviour is not already pinned
(`src/main/services/hydra-api.test.ts` pins routing; `scripts/electron-builder-config.test.mjs`
pins the macOS signing settings). Re-run until step 1 is empty.

## 5. Verify

```bash
yarn install --frozen-lockfile --ignore-scripts
yarn typecheck                     # node and web; the text merge hides errors here
(timeout 570 yarn -s test > /tmp/test.log 2>&1; echo "EXIT:$?" >> /tmp/test.log)   # several minutes
grep -E '^# (tests|pass|fail|skipped)|EXIT:' /tmp/test.log
npx eslint <changed files>; npx prettier --check <changed files>; npx commitlint --last
```

- `prettier --check .` may already fail on `main` for a file nobody touched; check `main`
  before blaming the merge.
- A background-command "completed" notice fires when the wrapper exits, not when the tests
  finish: wait for the `EXIT:` line.
- **End to end against the server** (the contract test): run all the suites in
  `../hydra-server/tests/e2e` against a running server, as its `README.md` says. They use
  the launcher's own validators and payload builders, so they fail when the two stop agreeing.
- CI builds every platform on a pull request; a new push cancels the run in progress, so
  read the result for the final head. The macOS build is where the Electron fuse re-sign
  matters.
- Cannot be done here, so say so: launching the app, the native libtorrent build, and
  anything that needs a real macOS or Windows machine.

## 6. Port to the server (only what step 2 listed)

Follow `reference/server-porting.md`. In order: the server change with tests, the launcher
capability gate and routing entry, the end-to-end test, the README. Version the server to
the launcher release. **Deploy the server before users move to the new launcher build.**

## 7. Hand off

Report to the user, plainly:

- OLD to NEW, the size, and the conflict count.
- The three lists from step 2, with the reason for each.
- What step 4 re-applied.
- What was verified, with the numbers, and **what was not**.

Open pull requests only if the user asks. When you do: the merge PR is merged with
**"Create a merge commit"** (say so in the description); the server PR is merged and
deployed first; stacked PRs merge into the merge branch before it goes to `main`. Offer to
watch the PRs with `subscribe_pr_activity`.

After it merges, update `reference/self-hosted-patch.md` if a patch point was added, moved
or removed, so the next merge starts from a true map.

## Gotchas

- `pkill -f <pattern>` kills the shell that runs it when the pattern is in the command;
  use `pkill -x <name>` or kill by PID.
- `cargo fmt` reformats files nobody touched; revert those.
- A presigned upload goes to `HYDRA_SERVER_PUBLIC_URL`, which must be reachable from the
  launcher's own computer; most "uploads do nothing" reports are that.
- `git stash` mid-merge, `git rebase` on the merge, and squashing the PR each destroy
  the merge ancestry.
