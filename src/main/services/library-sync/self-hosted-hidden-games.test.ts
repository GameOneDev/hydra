import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isHiddenOnSelfHostedServer,
  planHiddenGamesReconcile,
} from "./self-hosted-hidden-games-core.js";

const game = (
  objectId: string,
  flags: { isConcealed?: boolean; isHiddenFromOthers?: boolean } = {}
) => ({ shop: "steam" as const, objectId, ...flags });

describe("isHiddenOnSelfHostedServer", () => {
  it("hides a game concealed or hidden from others", () => {
    assert.equal(isHiddenOnSelfHostedServer({ isConcealed: true }), true);
    assert.equal(
      isHiddenOnSelfHostedServer({ isHiddenFromOthers: true }),
      true
    );
    assert.equal(isHiddenOnSelfHostedServer({}), false);
  });
});

describe("planHiddenGamesReconcile", () => {
  it("adds games the profile hides that the server doesn't list yet", () => {
    const plan = planHiddenGamesReconcile(
      [],
      [
        game("1", { isConcealed: true }),
        game("2", { isHiddenFromOthers: true }),
      ]
    );

    assert.deepEqual(plan.hide, [
      { shop: "steam", objectId: "1" },
      { shop: "steam", objectId: "2" },
    ]);
    assert.deepEqual(plan.unhide, []);
  });

  it("removes games the profile shows as revealed", () => {
    const plan = planHiddenGamesReconcile(
      [{ shop: "steam", objectId: "1" }],
      [game("1")]
    );

    assert.deepEqual(plan.hide, []);
    assert.deepEqual(plan.unhide, [{ shop: "steam", objectId: "1" }]);
  });

  it("leaves alone what already matches", () => {
    const plan = planHiddenGamesReconcile(
      [{ shop: "steam", objectId: "1" }],
      [game("1", { isConcealed: true })]
    );

    assert.deepEqual(plan, { hide: [], unhide: [] });
  });

  /* A launcher older than 4.1.6 hides a game by taking it off the profile,
     so a server entry with no profile game behind it must stay. */
  it("keeps entries for games the profile doesn't have", () => {
    const plan = planHiddenGamesReconcile(
      [{ shop: "steam", objectId: "gone" }],
      [game("1")]
    );

    assert.deepEqual(plan.unhide, []);
  });

  it("ignores custom games, which upstream can't conceal", () => {
    const plan = planHiddenGamesReconcile(
      [],
      [{ shop: "custom", objectId: "c", isConcealed: true }]
    );

    assert.deepEqual(plan.hide, []);
  });
});
