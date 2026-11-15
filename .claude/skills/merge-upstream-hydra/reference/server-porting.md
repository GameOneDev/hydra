# Porting a Hydra Cloud change into hydra-server

`GameOneDev/hydra-server` (Rust, axum 0.8, sqlx/SQLite). Check `../hydra-server`;
in a cloud session without it, attach it with the `add_repo` tool. The server
must be deployed **before** users move to a launcher build that needs it.

## When to port, and when not to

Port only what the fork routes to the server (`api_surface.py` says
SELF-HOSTED) or what changes the shape of a request the server already
answers. Do not port a feature that stays on official Hydra, and do not "just
add" an endpoint the launcher will never call.

The launcher side of a port has two parts, both in the fork:

1. A capability constant, e.g. `export const X_FEATURE = "x-thing";` (lower-case
   slug, so `api_surface.py` finds it), checked with `HydraApi.supportsCloudFeature(X_FEATURE)`
   before the feature does anything. It **fails closed**: a server without the
   capability gets no requests.
2. A routing entry: add the prefix to `CLOUD_ROUTED_PREFIXES` in `hydra-api.ts`
   (or `SELF_HOSTED_ONLY_PREFIXES` if official has no such path).

A change to an existing request (a new field, a new key form) is the same:
decide whether an old server can safely ignore it. If ignoring it would file or
delete data under the wrong key, gate it on a new capability (4.4.0's
`recompilationSlug` was exactly this: a server that ignored it filed a port's
saves under the plain game and deleted the emulator's saves with the port's).

## Where things live in the server

| What | Where |
| --- | --- |
| Routes the launcher calls | `fn router()` in `src/main.rs`; `api_routes` (launcher), `storage_routes` (presigned PUT `/storage/{token}`) |
| Capabilities | `capabilities()` in `src/main.rs`, the `"features": [...]` array. These strings are the contract |
| Schema | `migrations/NNNN_name.sql`, next number after the highest; sqlx runs them at startup |
| Quota | add the table to `METERED_TABLES` in `src/storage.rs` (the one list the quota check, the admin per-user column, the stored-bytes total and `/metrics` are all generated from), and to `quota_target` / `finalize_upload` there for presigned uploads |
| Files on disk | keys `images/<kind>/<user_id>/<uuid>.<ext>` or `cloud-saves/<user>/<hash>`; add the folder to `STORAGE_DIRS`; `src/admin/storage.rs` lists areas; purge, orphan sweep and integrity scan recognise a kind by key prefix |
| History | `events::record(&state, Event::sync("kind.name", user_id, "short title").description("longer text").detail(json!({...})))`; titles stay under 140 characters |
| Admin and portal | `src/admin/*.rs`, `static/admin/js/views/*.js`; the Events screen lists kinds from the data, so a new kind needs no front-end change |
| Docs | `README.md`: the endpoint list ("API surface"), the capabilities example, a section per feature, the environment table |
| Version | `Cargo.toml` follows the launcher release the server targets |
| Image | `.github/workflows/docker-publish.yml` publishes on a `v*` tag, not on merge |

## Rules the existing code follows (keep them)

- Every query is scoped `WHERE user_id = ?`; a key built from the request never
  reaches a filesystem path (uuid file names, owner-prefixed keys).
- A presign checks quota against the declared size **and the save checks it again
  against what landed**: a presigned PUT has no row until the save, so a check at
  presign alone can be passed several times. A replacement pays only the difference.
- Responses for a game or item that does not exist are the ordinary case, not an
  error (`PATCH` 404, `DELETE` 200), so the launcher can mirror every change.
- Everything the launcher matches on stays a stable code in `message`; text for a
  person goes beside it (`ApiError::with_extra`).
- Upload URLs are built from `HYDRA_SERVER_PUBLIC_URL`, and the launcher connects
  to exactly that, so it must work from the launcher's computer (not `localhost`
  unless the launcher is on the same machine).

## Verifying a port

```bash
cd ../hydra-server
cargo test                      # all of it; add tests that FAIL without the change
cargo fmt                       # then `git checkout` any file you did not mean to touch:
                                # artifacts.rs, emulation.rs and one comment in main.rs
                                # already differ and are reformatted by it
```

Then the end-to-end harness, which drives a **running** server with the
launcher's own code (so it fails if the two stop agreeing). The steps are in
`tests/e2e/README.md`; in short: start `node tests/e2e/stub-official-api.mjs`,
start the server on a scratch data dir with `HYDRA_ADMIN_PASSWORD` set, copy a
test file into the launcher next to the module it imports, run it with
`node --import ./scripts/register-ts-node.mjs --test <file>`, delete the copy.
Run all of them after any server change, not only the new one. Add a test
there for the new feature. Stop servers with `pkill -x hydra-server`; `pkill -f`
matches the shell running it and kills that.

Open the admin panel in a browser (headless Chromium is available) if the change
touches it; a screenshot caught what the API could not (the detail view showing
no title).

## The PR

State what was verified and what was not, with counts. The server has no test
CI (its only workflow publishes the image), so its numbers are local runs.
