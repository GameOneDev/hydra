#!/usr/bin/env python3
"""What changed in upstream's Hydra Cloud surface between two releases, and what
of it a self-hosted server has to answer.

    api_surface.py --old v4.4.0 --new v4.4.1 [--server ../hydra-server]
                   [--routing-rev HEAD] [--server-rev origin/main]
                   [--watch REGEX]

Read-only: it only reads git objects, so it can run before anything is merged.

The launcher decides per request whether official Hydra or the self-hosted
server answers it (`HydraApi.resolveInstance`). This reads that decision out of
the fork's own routing tables at --routing-rev and applies it to every endpoint
upstream's code calls at --old and --new, so each endpoint is classified as the
fork would route it:

  SELF-HOSTED   a prefix the fork routes there, or a call marked needsSubscription
  OFFICIAL      everything else, and the prefixes held back on purpose
  CONDITIONAL   routed there only for an account without a real subscription

Then it reports:

  1. endpoints new in --new, by class; for the SELF-HOSTED ones, whether the
     server (--server) has a route for them. Those it lacks are the ones to port.
  2. endpoints removed in --new.
  3. needsSubscription / hasActiveSubscription call sites that appeared. With a
     self-hosted server both are always true, so each new one is a feature the
     fork either routes there, holds on official, or gates on the real
     subscription, and the choice is a decision, not a default.
  4. files the self-hosted contract passes through that changed. A route that
     stays the same while its request or response changes shape is the case a
     list of endpoints cannot show (4.4.0's recompilationSlug on the existing
     cloud-save routes was one); the diffs of these files are what to read.
  5. path literals that look like API paths but are not direct HydraApi calls
     (built by helpers), at lower confidence.
  6. capability strings the fork requires of a server, against what --server
     advertises.

Endpoints are matched by path only, not by method.
"""
import argparse
import re
import subprocess
import sys
from collections import defaultdict

CALL_RE = re.compile(
    r"(?:HydraApi|hydraApi)\s*\.\s*"
    r"(get|post|put|patch|delete|getResponse|postResponse|putResponse|patchResponse|deleteResponse)"
    r"\s*(?:<[^()]*?>)?\s*\(\s*"
    r"(`(?:[^`\\]|\\.)*`|\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')",
    re.S,
)
DYNAMIC_RE = re.compile(
    r"(?:HydraApi|hydraApi)\s*\.\s*(get|post|put|patch|delete|getResponse|postResponse)"
    r"\s*(?:<[^()]*?>)?\s*\(\s*([A-Za-z_][\w.]*)"
)
NEEDS_SUB_RE = re.compile(r"needsSubscription\s*:\s*true")
SUBSCRIPTION_CHECK_RE = re.compile(r"\bhasActiveSubscription\s*\(|\bhasRealActiveSubscription\s*\(")
LITERAL_RE = re.compile(r"""[`"'](/[a-z][a-z0-9-]*(?:/[A-Za-z0-9_{}$.:\-]*)*)(?:\?[^`"']*)?[`"']""")

DEFAULT_WATCH = (
    r"cloud-save|souvenir|artwork|achievement-sync|library-sync|download-source|hidden-games|"
    r"banner|playtime|self-hosted|hydra-api|subscription|capabilit|contract|payload|manifest|"
    r"recompilation|screenshot-upload|screenshot-hd|local-screenshot|presigned"
)
# Where a request or response shape is defined: not the UI that renders it.
WATCH_DIRS = ("src/main/", "src/shared/", "src/types/")


def git(repo, *args, check=True, binary=False):
    p = subprocess.run(["git", "-C", repo, *args], capture_output=True, check=check)
    return p.stdout if binary else p.stdout.decode("utf-8", "replace")


def read_blobs(repo, rev, paths):
    """{path: text} for the given files at `rev`, in one git process."""
    if not paths:
        return {}
    request = "".join(f"{rev}:{p}\n" for p in paths).encode()
    out = subprocess.run(
        ["git", "-C", repo, "cat-file", "--batch"], input=request, capture_output=True, check=True
    ).stdout
    texts, pos = {}, 0
    for path in paths:
        end = out.index(b"\n", pos)
        header = out[pos:end].split()
        if len(header) < 3 or header[1] != b"blob":
            pos = end + 1
            continue
        size = int(header[2])
        texts[path] = out[end + 1 : end + 1 + size].decode("utf-8", "replace")
        pos = end + 1 + size + 1
    return texts


def source_files(repo, rev, pattern, subdir="src"):
    out = git(repo, "grep", "-l", "-E", pattern, rev, "--", subdir, check=False)
    paths = [line[len(rev) + 1 :] for line in out.splitlines()]
    return [p for p in paths if p.endswith((".ts", ".tsx")) and ".test." not in p]


def normalise(literal):
    text = literal[1:-1]
    text = re.sub(r"\$\{[^}]*\}", "{}", text)
    return text.split("?", 1)[0]


def endpoints_at(repo, rev):
    """{(path): {"methods": set, "files": set, "needs_sub": bool}} plus dynamic call sites."""
    files = source_files(repo, rev, r"HydraApi|hydraApi")
    found = defaultdict(lambda: {"methods": set(), "files": set(), "needs_sub": False})
    dynamic = set()
    for path, text in read_blobs(repo, rev, files).items():
        for m in CALL_RE.finditer(text):
            entry = found[normalise(m.group(2))]
            entry["methods"].add(m.group(1).upper())
            entry["files"].add(path)
            # The options object follows the path within a few lines; stop at the next call.
            tail = text[m.end() : m.end() + 500]
            tail = re.split(r"(?:HydraApi|hydraApi)\s*\.", tail, maxsplit=1)[0]
            if NEEDS_SUB_RE.search(tail):
                entry["needs_sub"] = True
        for m in DYNAMIC_RE.finditer(text):
            dynamic.add((m.group(1).upper(), m.group(2), path))

    # A path held in a constant is still a literal path: resolve it.
    constants = path_constants(repo, rev)
    unresolved = set()
    for method, name, path in dynamic:
        if name in constants:
            entry = found[constants[name]]
            entry["methods"].add(method)
            entry["files"].add(path)
        else:
            unresolved.add((method, name, path))
    return found, unresolved


def path_constants(repo, rev):
    """{NAME: "/literal/path"} for string constants that look like API paths."""
    files = source_files(repo, rev, r"[A-Za-z_]\w*\s*=\s*[`\"']/[a-z]")
    constants = {}
    for text in read_blobs(repo, rev, files).values():
        for name, literal in re.findall(r"\b([A-Za-z_]\w*)\s*=\s*(`[^`]*`|\"[^\"]*\"|'[^']*')", text):
            value = normalise(literal)
            if value.startswith("/"):
                constants.setdefault(name, value)
    return constants


def subscription_sites(repo, rev):
    """{path: (needsSubscription:true count, subscription check count)}."""
    files = source_files(repo, rev, r"needsSubscription|hasActiveSubscription|hasRealActiveSubscription")
    sites = {}
    for path, text in read_blobs(repo, rev, files).items():
        sites[path] = (len(NEEDS_SUB_RE.findall(text)), len(SUBSCRIPTION_CHECK_RE.findall(text)))
    return sites


# ---------------------------------------------------------------- routing

def strip_comments(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", text)


def string_list(text, name):
    m = re.search(rf"{name}\s*=\s*\[(.*?)\]\s*;", text, re.S)
    if not m:
        return []
    return re.findall(r"[\"'`]([^\"'`]+)[\"'`]", strip_comments(m.group(1)))


def read_routing(repo, rev):
    """The fork's routing tables, parsed out of its own source at `rev`."""
    api = read_blobs(repo, rev, ["src/main/services/hydra-api.ts"]).get("src/main/services/hydra-api.ts")
    if api is None:
        sys.exit(f"src/main/services/hydra-api.ts not found at {rev}: is --routing-rev a fork revision?")
    routing = {
        "cloud": string_list(api, "CLOUD_ROUTED_PREFIXES"),
        "fallback": string_list(api, "CLOUD_FALLBACK_PREFIXES"),
        "official": string_list(api, "OFFICIAL_ONLY_PREFIXES"),
        "self_only": string_list(api, "SELF_HOSTED_ONLY_PREFIXES"),
        "souvenir_prefixes": [],
        "souvenir_patterns": [],
    }
    souvenir = read_blobs(repo, rev, ["src/main/services/souvenir-routes.ts"]).get(
        "src/main/services/souvenir-routes.ts"
    )
    if souvenir:
        routing["souvenir_prefixes"] = string_list(souvenir, "SOUVENIR_ROUTED_PREFIXES")
        block = re.search(r"SOUVENIR_ROUTED_PATTERNS\s*=\s*\[(.*?)\]\s*;", souvenir, re.S)
        for lit in re.findall(r"^\s*/(.+)/[a-z]*,?\s*$", strip_comments(block.group(1)), re.M) if block else []:
            try:
                routing["souvenir_patterns"].append(re.compile(lit.replace("\\/", "/")))
            except re.error:
                pass
    return routing


def classify(path, needs_sub, routing):
    """Mirrors HydraApi.resolveInstance for a request to `path`."""
    starts = lambda prefixes: any(path.startswith(p) for p in prefixes)
    if starts(routing["official"]):
        return "OFFICIAL"
    if starts(routing["self_only"]):
        return "SELF-HOSTED"
    if starts(routing["souvenir_prefixes"]) or any(p.search(path) for p in routing["souvenir_patterns"]):
        return "SELF-HOSTED"
    if needs_sub or starts(routing["cloud"]):
        return "SELF-HOSTED"
    if starts(routing["fallback"]):
        return "CONDITIONAL"
    return "OFFICIAL"


# ----------------------------------------------------------------- server

def read_server(repo, rev):
    """(route patterns, advertised features) from the server's main.rs."""
    text = git(repo, "show", f"{rev}:src/main.rs", check=False)
    if not text:
        sys.exit(f"src/main.rs not found at {rev} in {repo}: is --server a hydra-server checkout?")
    routes = [re.sub(r"\{[^}]*\}", "{}", r) for r in re.findall(r"\.route\(\s*\"([^\"]+)\"", text)]
    feats = re.search(r"\"features\"\s*:\s*\[(.*?)\]", text, re.S)
    features = re.findall(r"\"([^\"]+)\"", feats.group(1)) if feats else []
    return routes, features


def served(path, routes):
    parts = path.split("/")
    for route in routes:
        rparts = route.split("/")
        if len(rparts) == len(parts) and all(a == b or "{}" in (a, b) for a, b in zip(parts, rparts)):
            return True
    return False


def required_features(repo, rev):
    """Capability strings the fork asks a server for, resolved through their constants."""
    files = source_files(repo, rev, r"supportsCloudFeature|_FEATURE\b", "src")
    texts = read_blobs(repo, rev, files)
    constants = {}
    for text in texts.values():
        for name, value in re.findall(r"\b([A-Z][A-Z0-9_]*_FEATURE)\s*=\s*\"([^\"]+)\"", text):
            constants[name] = value
    required = {}
    # Official Hydra's own feature flags are UPPER_CASE; a server capability is a lower-case slug.
    for path, text in texts.items():
        for name, value in re.findall(r"\b([A-Z][A-Z0-9_]*_FEATURE)\s*=\s*\"([a-z][a-z0-9-]*)\"", text):
            required.setdefault(value, path)
        for arg in re.findall(r"supportsCloudFeature\(\s*([A-Za-z_\"][\w\"\-.]*)", text):
            value = arg.strip('"') if arg.startswith('"') else constants.get(arg)
            if value:
                required.setdefault(value, path)
    return required


# ----------------------------------------------------------------- report

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--old", required=True, help="the upstream release already in the fork")
    ap.add_argument("--new", required=True, help="the upstream release being merged")
    ap.add_argument("--routing-rev", default="HEAD", help="fork revision whose routing tables apply (default HEAD)")
    ap.add_argument("--server", help="path to a hydra-server checkout, to see which routes it has")
    ap.add_argument("--server-rev", default="HEAD", help="revision of the server to read (default HEAD)")
    ap.add_argument("--watch", default=DEFAULT_WATCH, help="regex of paths the self-hosted contract passes through")
    ap.add_argument("--max-files", type=int, default=30, help="how many other watched files to list (default 30)")
    args = ap.parse_args()
    repo = args.repo

    routing = read_routing(repo, args.routing_rev)
    old, _ = endpoints_at(repo, args.old)
    new, new_unresolved = endpoints_at(repo, args.new)
    _, old_unresolved = endpoints_at(repo, args.old)
    for name in ("cloud", "official", "souvenir_prefixes"):
        if not routing[name]:
            print(f"warning: no {name} prefixes parsed from the routing tables; the classification may be wrong\n")

    server_routes, server_features = ([], [])
    if args.server:
        server_routes, server_features = read_server(args.server, args.server_rev)

    cls = lambda path, info: classify(path, info["needs_sub"], routing)
    out = []
    emit = out.append

    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))

    # ---- 1
    emit(f"## 1. New endpoints: {len(added)}")
    by_class = defaultdict(list)
    for path in added:
        by_class[cls(path, new[path])].append(path)
    must_port = []
    for klass in ("SELF-HOSTED", "CONDITIONAL", "OFFICIAL"):
        group = by_class.get(klass, [])
        if not group:
            continue
        emit(f"\n### {klass} ({len(group)})")
        for path in group:
            info = new[path]
            line = f"- {'/'.join(sorted(info['methods']))} {path}"
            if info["needs_sub"]:
                line += "   [needsSubscription]"
            if klass != "OFFICIAL" and args.server:
                ok = served(path, server_routes)
                line += "   server: " + ("has a route" if ok else "NO ROUTE  <-- port this")
                if not ok:
                    must_port.append(path)
            emit(line + f"   <- {', '.join(sorted(info['files']))}")
    if not added:
        emit("(none)")

    # ---- 2
    emit(f"\n## 2. Endpoints removed: {len(removed)}")
    for path in removed:
        emit(f"- {'/'.join(sorted(old[path]['methods']))} {path}   (was {cls(path, old[path])})")

    # ---- 3
    emit("\n## 3. Subscription gates that appeared")
    before, after = subscription_sites(repo, args.old), subscription_sites(repo, args.new)
    gates = []
    for path in sorted(set(before) | set(after)):
        b, a = before.get(path, (0, 0)), after.get(path, (0, 0))
        if a[0] > b[0] or a[1] > b[1]:
            gates.append(f"- {path}: needsSubscription {b[0]}->{a[0]}, subscription checks {b[1]}->{a[1]}")
    emit("\n".join(gates) if gates else "(none: the same files carry the same number of gates)")
    emit("  Each is a decision: route it to the self-hosted server, hold it on official"
         " (OFFICIAL_ONLY_PREFIXES), or gate it on hasRealActiveSubscription().")

    # ---- 4
    emit("\n## 4. Changed files on the self-hosted contract's path")
    watch = re.compile(args.watch)
    routed_files = set()
    for path, info in {**old, **new}.items():
        if cls(path, info) != "OFFICIAL":
            routed_files |= info["files"]
    direct, other = [], []
    brand_new = set(git(repo, "diff", "--name-only", "--diff-filter=A", args.old, args.new, "--", "src").split("\n"))
    for line in git(repo, "diff", "--numstat", args.old, args.new, "--", "src").splitlines():
        plus, minus, name = line.split("\t", 2)
        if ".test." in name or not name.endswith((".ts", ".tsx")):
            continue
        churn = (int(plus) if plus.isdigit() else 0) + (int(minus) if minus.isdigit() else 0)
        if name in routed_files:
            direct.append((name, plus, minus, churn))
        elif name.startswith(WATCH_DIRS) and watch.search(name):
            other.append((name, plus, minus, churn))
    emit(f"\n### Files that call an endpoint the fork routes to the self-hosted server: {len(direct)}")
    for name, plus, minus, _ in sorted(direct):
        emit(f"- +{plus}/-{minus}  {name}")
    other.sort(key=lambda row: -row[3])
    modified = [row for row in other if row[0] not in brand_new]
    new_files = [row for row in other if row[0] in brand_new]
    emit(f"\n### Existing files where a request or response shape is defined, modified: {len(modified)}")
    for name, plus, minus, _ in modified[: args.max_files]:
        emit(f"- +{plus}/-{minus}  {name}")
    if len(modified) > args.max_files:
        emit(f"- ... and {len(modified) - args.max_files} more (raise --max-files)")
    emit("  Read these diffs first: a request or response that changed shape under an unchanged route"
         " does not appear in section 1.")
    emit(f"\n### The same kind of file, new in {args.new}: {len(new_files)}")
    shown = max(10, args.max_files // 2)
    for name, plus, minus, _ in new_files[:shown]:
        emit(f"- +{plus}  {name}")
    if len(new_files) > shown:
        emit(f"- ... and {len(new_files) - shown} more")
    emit("  Read one of these only if it builds a request to a routed endpoint or a shop/object key.")

    # ---- 5
    emit("\n## 5. API-looking path literals new in --new that are not direct calls (lower confidence)")
    first_segments = {p.split("/")[1] for p in {**old, **new} if p.count("/") >= 1}

    def literals(rev):
        files = set(source_files(repo, rev, r"[`\"']/[a-z]", "src/main")) | set(
            source_files(repo, rev, r"[`\"']/[a-z]", "src/shared")
        )
        found = {}
        for path, text in read_blobs(repo, rev, sorted(files)).items():
            for m in LITERAL_RE.finditer(text):
                lit = re.sub(r"\$\{[^}]*\}", "{}", m.group(1))
                if lit.split("/")[1] in first_segments:
                    found.setdefault(lit, path)
        return found

    new_lits, old_lits = literals(args.new), literals(args.old)
    extra = [(p, f) for p, f in sorted(new_lits.items()) if p not in old_lits and p not in new]
    for path, file in extra:
        emit(f"- {path}   [{cls(path, {'needs_sub': False})}]   <- {file}")
    if not extra:
        emit("(none)")

    # ---- 6
    emit("\n## 6. Capabilities")
    required = required_features(repo, args.routing_rev)
    emit(f"the fork requires {len(required)} capability strings of a server: {', '.join(sorted(required))}")
    missing = []
    if args.server:
        missing = sorted(set(required) - set(server_features))
        emit(f"the server advertises {len(server_features)}; "
             + ("MISSING: " + ", ".join(missing) if missing else "none of the required ones are missing"))
    else:
        emit("(pass --server to compare with what the server advertises)")

    # ---- 7
    new_calls = sorted(new_unresolved - old_unresolved)
    emit(f"\n## 7. New calls whose path is a variable or a helper's result: {len(new_calls)}")
    for method, expr, file in new_calls:
        emit(f"- {method} {expr}   <- {file}")
    if new_calls:
        emit("  This script cannot classify these. Read each: they are the endpoints it did not see.")

    # ---- summary, printed first
    print(f"# Upstream cloud surface: {args.old} -> {args.new}")
    print(f"routing read from {args.routing_rev}; {len(old)} endpoints at {args.old}, {len(new)} at {args.new}\n")
    print("## Summary")
    print(f"- new endpoints: {len(added)}  (self-hosted {len(by_class.get('SELF-HOSTED', []))}, "
          f"conditional {len(by_class.get('CONDITIONAL', []))}, official {len(by_class.get('OFFICIAL', []))})")
    if args.server:
        print(f"- routed to the self-hosted server with NO route there: {len(must_port)}"
              + ("   <-- port these" if must_port else ""))
        print(f"- capabilities the fork requires that the server lacks: {len(missing)}")
    print(f"- new subscription gates: {len(gates)}")
    print(f"- changed files calling a self-hosted route: {len(direct)}; "
          f"other modified contract files: {len(modified)} (+ {len(new_files)} new)")
    print(f"- calls this script could not classify: {len(new_calls)}\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
