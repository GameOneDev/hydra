import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyHdScreenshotCopies,
  collectHdScreenshotRefs,
  getBulkDeletedGame,
  getEditedScreenshotId,
  HD_COPY_RETRY_DELAYS_MS,
  isAwaitingHdCopy,
  isRetryableHdCopyStatus,
  isScreenshotReadUrl,
  planHdCopyAfterFailure,
} from "./screenshot-hd-copies-core.js";

const shot = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  owner: { id: "owner-1" },
  imageUrl: `https://official.test/${id}-720.jpg`,
  thumbnailUrl: `https://official.test/${id}-thumb.jpg`,
  width: 1280,
  height: 720,
  ...extra,
});

const copy = (id: string) => ({
  url: `https://mine.test/images/screenshots-hd/${id}.jpg`,
  width: 1920,
  height: 1080,
});

describe("which responses carry screenshots", () => {
  it("recognises every route the UI lists or returns them from", () => {
    for (const url of [
      "/users/u1/screenshots?take=24&sort=recent",
      "/users/u1/screenshots",
      "/users/u1/screenshots/s1",
      "/games/steam/570/screenshots?take=24",
      "/profile/screenshots?shop=steam&objectId=570",
      "/profile/screenshots/s1",
    ]) {
      assert.equal(isScreenshotReadUrl(url), true, url);
    }
  });

  it("leaves alone what carries no screenshot image", () => {
    for (const url of [
      "/users/u1/screenshots/games",
      "/users/u1/screenshots/s1/comments?take=20",
      "/users/u1/screenshots/s1/like",
      "/profile/screenshots/s1/complete",
      "/users/u1/library?take=12",
      "/leaderboards/playtime",
      "/presigned-urls/screenshot",
    ]) {
      assert.equal(isScreenshotReadUrl(url), false, url);
    }
  });

  it("reads the id out of an edit or delete, and nothing else", () => {
    assert.equal(getEditedScreenshotId("/profile/screenshots/abc-1"), "abc-1");
    assert.equal(
      getEditedScreenshotId("/profile/screenshots/a%2Fb"),
      "a/b",
      "an encoded id comes back decoded"
    );
    assert.equal(getEditedScreenshotId("/profile/screenshots"), null);
    assert.equal(
      getEditedScreenshotId("/profile/screenshots/s1/complete"),
      null
    );
    assert.equal(getEditedScreenshotId("/users/u1/screenshots/s1"), null);
  });
});

describe("which screenshots may take a copy", () => {
  it("collects a listing, a bare array and a single screenshot", () => {
    const url = "/users/u1/screenshots";

    assert.deepEqual(
      collectHdScreenshotRefs(url, { items: [shot("a"), shot("b")] }),
      [
        { userId: "owner-1", id: "a" },
        { userId: "owner-1", id: "b" },
      ]
    );
    assert.deepEqual(collectHdScreenshotRefs(url, [shot("a")]), [
      { userId: "owner-1", id: "a" },
    ]);
    assert.deepEqual(collectHdScreenshotRefs(url, shot("a")), [
      { userId: "owner-1", id: "a" },
    ]);
  });

  it("asks once about a screenshot that appears twice", () => {
    assert.deepEqual(
      collectHdScreenshotRefs("/users/u1/screenshots", {
        items: [shot("a"), shot("a")],
      }),
      [{ userId: "owner-1", id: "a" }]
    );
  });

  /* The rule that keeps a copy from showing what official Hydra withheld. */
  it("never offers a copy to a screenshot official did not give an image", () => {
    const refs = collectHdScreenshotRefs("/users/u1/screenshots", {
      items: [
        shot("withheld", { imageUrl: null }),
        shot("empty", { imageUrl: "" }),
        shot("blocked", { moderationStatus: "BLOCKED" }),
        shot("pending", { moderationStatus: "PENDING" }),
        shot("approved", { moderationStatus: "APPROVED" }),
      ],
    });

    assert.deepEqual(
      refs.map(({ id }) => id),
      ["pending", "approved"]
    );
  });

  it("takes the owner from the profile being viewed when the item has none", () => {
    const { owner: _owner, ...ownerless } = shot("a");

    assert.deepEqual(
      collectHdScreenshotRefs("/users/profile%20owner/screenshots", [
        ownerless,
      ]),
      [{ userId: "profile owner", id: "a" }]
    );
    assert.deepEqual(
      collectHdScreenshotRefs("/games/steam/570/screenshots", [ownerless]),
      [],
      "no owner to ask about, so no question"
    );
  });

  it("ignores what is not a screenshot at all", () => {
    assert.deepEqual(
      collectHdScreenshotRefs("/users/u1/screenshots", null),
      []
    );
    assert.deepEqual(collectHdScreenshotRefs("/users/u1/screenshots", "x"), []);
    assert.deepEqual(
      collectHdScreenshotRefs("/users/u1/screenshots", {
        items: [1, null, {}],
      }),
      []
    );
  });
});

describe("putting copies in", () => {
  it("replaces the image and its size together and leaves the thumbnail", () => {
    const response = { items: [shot("a"), shot("b")], total: 2 };

    const replaced = applyHdScreenshotCopies(response, { a: copy("a") });

    assert.equal(replaced, 1);
    assert.equal(response.items[0].imageUrl, copy("a").url);
    assert.equal(response.items[0].width, 1920);
    assert.equal(response.items[0].height, 1080);
    assert.equal(
      response.items[0].thumbnailUrl,
      "https://official.test/a-thumb.jpg"
    );
    assert.equal(response.total, 2, "the rest of the response is untouched");
  });

  it("keeps official's image wherever there is no copy", () => {
    const response = { items: [shot("b")] };

    assert.equal(applyHdScreenshotCopies(response, { a: copy("a") }), 0);
    assert.equal(response.items[0].imageUrl, "https://official.test/b-720.jpg");
    assert.equal(response.items[0].width, 1280);
  });

  it("will not use a copy the server answered badly", () => {
    const response = { items: [shot("a")] };

    for (const bad of [
      null,
      "https://mine.test/x.jpg",
      { url: "", width: 1920, height: 1080 },
      { url: "https://mine.test/x.jpg" },
      { url: "https://mine.test/x.jpg", width: "1920", height: 1080 },
    ]) {
      assert.equal(applyHdScreenshotCopies(response, { a: bad }), 0);
    }
    assert.equal(response.items[0].imageUrl, "https://official.test/a-720.jpg");
  });

  /* Even if a copy exists for it, a blocked screenshot keeps official's. */
  it("does not put a copy on a screenshot that cannot take one", () => {
    const response = {
      items: [
        shot("blocked", { moderationStatus: "BLOCKED" }),
        shot("withheld", { imageUrl: null }),
      ],
    };

    const replaced = applyHdScreenshotCopies(response, {
      blocked: copy("blocked"),
      withheld: copy("withheld"),
    });

    assert.equal(replaced, 0);
    assert.equal(response.items[1].imageUrl, null);
  });
});

describe("trying a failed copy again", () => {
  it("waits longer after each failure", () => {
    const now = 1_000;

    for (
      let attempts = 1;
      attempts <= HD_COPY_RETRY_DELAYS_MS.length;
      attempts++
    ) {
      assert.deepEqual(planHdCopyAfterFailure(attempts, now), {
        state: "pending",
        attempts,
        nextAttemptAt: now + HD_COPY_RETRY_DELAYS_MS[attempts - 1],
      });
    }

    const delays = HD_COPY_RETRY_DELAYS_MS;
    assert.deepEqual(
      delays,
      delays.toSorted((a, b) => a - b),
      "never shorter than the one before"
    );
  });

  it("gives up once the delays run out", () => {
    const attempts = HD_COPY_RETRY_DELAYS_MS.length + 1;

    assert.deepEqual(planHdCopyAfterFailure(attempts, 5), {
      state: "skipped",
      attempts,
      nextAttemptAt: null,
    });
  });

  it("retries what might work later and gives up on what will not", () => {
    for (const status of [undefined, 408, 409, 425, 429, 500, 502, 503]) {
      assert.equal(isRetryableHdCopyStatus(status), true, String(status));
    }
    for (const status of [400, 401, 403, 404, 405, 413, 422]) {
      assert.equal(isRetryableHdCopyStatus(status), false, String(status));
    }
  });
});

describe("a delete that names no screenshot", () => {
  it("reads the game out of a bulk delete, and nothing else", () => {
    assert.deepEqual(
      getBulkDeletedGame("/profile/screenshots?shop=steam&objectId=570"),
      { shop: "steam", objectId: "570" }
    );
    assert.deepEqual(
      getBulkDeletedGame("/profile/screenshots?shop=epic&objectId=fn%3Aabc"),
      { shop: "epic", objectId: "fn:abc" },
      "an encoded id comes back decoded"
    );

    for (const url of [
      "/profile/screenshots",
      "/profile/screenshots?shop=steam",
      "/profile/screenshots?objectId=570",
      "/profile/screenshots/s1",
      "/users/u1/screenshots?shop=steam&objectId=570",
    ]) {
      assert.equal(getBulkDeletedGame(url), null, url);
    }
  });

  it("is not the delete of one screenshot, which is read by its id", () => {
    const url = "/profile/screenshots?shop=steam&objectId=570";

    assert.equal(getEditedScreenshotId(url), null);
    assert.notEqual(getBulkDeletedGame(url), null);
  });
});

describe("what the self-hosted server may tell the launcher to show", () => {
  const apply = (copies: Record<string, unknown>) => {
    const item = shot("s1");
    const replaced = applyHdScreenshotCopies({ items: [item] }, copies);
    return { replaced, item };
  };

  it("takes an https image with a real size", () => {
    const { replaced, item } = apply({ s1: copy("s1") });

    assert.equal(replaced, 1);
    assert.equal(item.imageUrl, copy("s1").url);
  });

  it("refuses an address that is not a web address, whatever the size", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "not a url",
      "",
    ]) {
      const { replaced, item } = apply({ s1: { ...copy("s1"), url } });

      assert.equal(replaced, 0, url);
      assert.equal(item.imageUrl, "https://official.test/s1-720.jpg");
    }
  });

  it("refuses a size that is not a positive finite number", () => {
    for (const size of [0, -1, Number.NaN, Infinity, "1920", null]) {
      const { replaced } = apply({ s1: { ...copy("s1"), width: size } });
      assert.equal(replaced, 0, String(size));
    }
  });

  it("answers an id only from what the server listed, never from a prototype", () => {
    /* JSON can carry an own "__proto__" key, and copying it with Object.assign
       onto a plain object replaces that object's prototype. */
    const parsed = JSON.parse(
      '{"__proto__": {"s1": {"url": "https://evil.test/a.jpg", "width": 1, "height": 1}}}'
    );
    const copies = Object.assign({}, parsed) as Record<string, unknown>;

    assert.ok(copies.s1, "the prototype now answers for s1");

    const { replaced, item } = apply(copies);
    assert.equal(replaced, 0);
    assert.equal(item.imageUrl, "https://official.test/s1-720.jpg");
  });
});

describe("whether an attempt's outcome may still be written", () => {
  const waiting = {
    state: "uploaded" as const,
    screenshotId: "s1",
    hdCopy: { state: "pending" as const, attempts: 0, nextAttemptAt: null },
  };

  it("is when it is the same screenshot, still published and waiting", () => {
    assert.equal(isAwaitingHdCopy(waiting, "s1"), true);
  });

  it("is not once official deleted it and it was published again as another", () => {
    assert.equal(
      isAwaitingHdCopy({ ...waiting, screenshotId: "s2" }, "s1"),
      false
    );
    assert.equal(
      isAwaitingHdCopy(
        { ...waiting, state: "local", screenshotId: null },
        "s1"
      ),
      false,
      "unpublished"
    );
  });

  it("is not once it was blocked, uploaded by someone else, or had its state reset", () => {
    for (const hdCopy of [
      { state: "skipped" as const, attempts: 1, nextAttemptAt: null },
      { state: "uploaded" as const, attempts: 1, nextAttemptAt: null },
      undefined,
    ]) {
      assert.equal(isAwaitingHdCopy({ ...waiting, hdCopy }, "s1"), false);
    }
  });
});
