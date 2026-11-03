import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGameLinks } from "./self-hosted-game-links-core.js";

describe("buildGameLinks", () => {
  it("sends only Steam and Epic games the catalogue linked", () => {
    assert.deepEqual(
      buildGameLinks([
        { shop: "steam", objectId: "570", canonicalId: "c1" },
        { shop: "epic", objectId: "ns:item", canonicalId: "c1" },
        { shop: "steam", objectId: "440" },
        { shop: "launchbox", objectId: "x", canonicalId: "c2" },
      ]),
      [
        { shop: "steam", objectId: "570", canonicalId: "c1" },
        { shop: "epic", objectId: "ns:item", canonicalId: "c1" },
      ]
    );
  });
});
