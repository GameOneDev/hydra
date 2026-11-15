#!/usr/bin/env python3
"""Checks a finished upstream merge against the four trees it came from.

    merge_integrity.py --upstream v4.5.0 --main origin/main [--head HEAD]
                       [--base <upstream commit the fork was last based on>]
                       [--known-edit PATH ...] [--markers REGEX]

Every file is classified by who changed it since BASE:

  only upstream changed it   HEAD must equal UPSTREAM's version
  only the fork changed it   HEAD must equal MAIN's version
  both changed it            a real merge; the files where HEAD took one side
                             wholesale are listed, since they may have dropped
                             the other side's change

A file that breaks the first two rules is a VIOLATION unless it is named with
--known-edit (a file the merge was meant to change: a build fix, a patch point
re-applied where upstream rewrote the code). The exit status is 1 when there
are violations, so an unexpected one fails loudly.

It also looks for the self-hosted patch itself: files where the number of
MARKERS (calls into the fork's self-hosted layer) is lower in HEAD than in MAIN.
A lower count is not always a mistake (code moves), but a patch point that
vanished in a merge is silent otherwise: the text merge compiles and the
feature quietly stops working with a self-hosted server.

MAIN is the fork's main as it was BEFORE the merge, not after: pass the commit
the merge branch was created from (for example `origin/main` while the branch
is unmerged, or `<merge-commit>^1` afterwards).
"""
import argparse
import fnmatch
import re
import subprocess
import sys

DEFAULT_MARKERS = (
    r"isSelfHostedCloudEnabled|supportsCloudFeature|hasRealActiveSubscription|"
    r"forceSelfHostedApi|forceOfficialApi|supportsAchievementSouvenirs|"
    r"self-hosted|selfHosted|SelfHosted"
)


def git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", repo, *args], capture_output=True, text=True, check=check
    ).stdout


def tree(repo, ref):
    """{path: blob id} for every file at `ref`."""
    files = {}
    for line in git(repo, "ls-tree", "-r", "-z", ref).split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        files[path] = meta.split()[2]
    return files


def marker_counts(repo, ref, pattern):
    """{path: occurrences of the marker pattern} at `ref`, source files only."""
    out = git(
        repo, "grep", "-c", "-E", pattern, ref, "--", "src", "scripts", check=False
    )
    counts = {}
    for line in out.splitlines():
        # "<ref>:<path>:<count>"; the path may itself contain ':' on no real repo.
        body = line[len(ref) + 1 :]
        path, _, count = body.rpartition(":")
        if path and count.isdigit():
            counts[path] = int(count)
    return counts


def resolve_base(repo, main, upstream, explicit):
    if explicit:
        return explicit
    bases = git(repo, "merge-base", "--all", main, upstream).split()
    if len(bases) == 1:
        return bases[0]
    sys.exit(
        "Cannot pick BASE on my own: "
        + (f"{len(bases)} merge bases ({' '.join(b[:9] for b in bases)})" if bases else "no merge base")
        + ".\nThis is the criss-cross history the skill warns about. Pass --base with the last\n"
        "upstream commit already in the fork, after comparing candidates with\n"
        "`git merge-tree --write-tree --merge-base=<candidate> <main> <upstream>`."
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--upstream", required=True, help="the upstream release being merged (tag or commit)")
    ap.add_argument("--main", default="origin/main", help="the fork's main BEFORE the merge")
    ap.add_argument("--head", default="HEAD", help="the merge result")
    ap.add_argument("--base", help="upstream commit the fork was last based on (default: the single merge base)")
    ap.add_argument("--known-edit", action="append", default=[], metavar="GLOB",
                    help="a file the merge was meant to change; repeatable, globs allowed")
    ap.add_argument("--markers", default=DEFAULT_MARKERS, help="regex of the fork's self-hosted call markers")
    args = ap.parse_args()

    repo = args.repo
    base = resolve_base(repo, args.main, args.upstream, args.base)
    print(f"BASE     {base[:12]}\nMAIN     {args.main}\nUPSTREAM {args.upstream}\nHEAD     {args.head}\n")

    b, m, u, h = (tree(repo, r) for r in (base, args.main, args.upstream, args.head))
    known = lambda path: any(fnmatch.fnmatch(path, g) for g in args.known_edit)

    only_up, only_fork, both_same = [], [], []
    merged, took_main, took_up, violations = [], [], [], []

    for path in sorted(set(b) | set(m) | set(u) | set(h)):
        bb, mm, uu, hh = b.get(path), m.get(path), u.get(path), h.get(path)

        if mm == bb and uu == bb:
            if hh != bb and not known(path):
                violations.append((path, "nobody changed it, but HEAD differs"))
        elif mm == bb:
            only_up.append(path)
            if hh != uu and not known(path):
                violations.append((path, "only upstream changed it; HEAD is not upstream's"))
        elif uu == bb:
            only_fork.append(path)
            if hh != mm and not known(path):
                violations.append((path, "only the fork changed it; HEAD is not main's"))
        elif mm == uu:
            both_same.append(path)
            if hh != mm and not known(path):
                violations.append((path, "both made the same change; HEAD differs"))
        elif hh == mm:
            took_main.append(path)
        elif hh == uu:
            took_up.append(path)
        else:
            merged.append(path)

    print(f"files: {len(set(b) | set(m) | set(u) | set(h))}")
    print(f"  only upstream changed: {len(only_up)}")
    print(f"  only the fork changed: {len(only_fork)}")
    print(f"  both, same change:     {len(both_same)}")
    print(f"  both, differently:     {len(merged) + len(took_main) + len(took_up)}"
          f"  (merged {len(merged)}, took main's {len(took_main)}, took upstream's {len(took_up)})")

    print(f"\nVIOLATIONS: {len(violations)}")
    for path, why in violations:
        print(f"  {path}\n      {why}")

    def show(title, group, why):
        print(f"\n{title}: {len(group)}\n  ({why})")
        for path in group:
            print(f"  {path}")

    show("TOOK MAIN'S VERSION of a file upstream also changed", took_main,
         "upstream's change to it is NOT in HEAD; confirm that was intended")
    show("TOOK UPSTREAM'S VERSION of a file the fork also changed", took_up,
         "the fork's change to it is NOT in HEAD; confirm it was re-applied elsewhere or is obsolete")
    show("REAL MERGES of both sides", merged,
         "hand-resolved or auto-merged; the review surface")

    before = marker_counts(repo, args.main, args.markers)
    after = marker_counts(repo, args.head, args.markers)
    lost = sorted(
        (path, before[path], after.get(path, 0))
        for path in before
        if after.get(path, 0) < before[path]
    )
    print(f"\nSELF-HOSTED MARKERS that went down since MAIN: {len(lost)}")
    print("  (a patch point may have been dropped; moved or intentionally removed code also shows here)")
    for path, was, now in lost:
        gone = "" if path in h else "   [file no longer exists]"
        print(f"  {path}: {was} -> {now}{gone}")

    sys.exit(1 if violations else 0)


if __name__ == "__main__":
    main()
