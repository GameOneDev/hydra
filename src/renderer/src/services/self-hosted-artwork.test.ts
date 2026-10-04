import assert from "node:assert";
import { describe, it } from "node:test";

import type { UserGame } from "@types";

import {
  applySelfHostedArtwork,
  type SelfHostedArtworkMap,
} from "./self-hosted-artwork.js";

const game = (objectId: string): UserGame =>
  ({
    objectId,
    shop: "steam",
    title: `Game ${objectId}`,
    iconUrl: null,
    coverImageUrl: null,
    customLibraryImageUrl: null,
  }) as unknown as UserGame;

const artworkFor = (objectId: string): SelfHostedArtworkMap =>
  new Map([[`steam:${objectId}`, { grids: "https://server/cover.png" }]]);

describe("applySelfHostedArtwork", () => {
  it("overlays self-hosted images onto matching games", () => {
    const [result] = applySelfHostedArtwork([game("440")], artworkFor("440"));

    assert.equal(result.customLibraryImageUrl, "https://server/cover.png");
  });

  it("leaves games the server has no artwork for untouched", () => {
    const [result] = applySelfHostedArtwork([game("440")], artworkFor("570"));

    assert.equal(result.customLibraryImageUrl, null);
  });

  /* The profile endpoint types its game lists as always present but omits
     them in some responses. Throwing here surfaced to the user as "User not
     found", because the caller's catch covers the whole chain. */
  it("tolerates a missing game list instead of throwing", () => {
    assert.deepEqual(applySelfHostedArtwork(undefined, artworkFor("440")), []);
    assert.deepEqual(applySelfHostedArtwork(null, artworkFor("440")), []);
  });

  it("returns the games unchanged when there is no artwork", () => {
    const games = [game("440")];

    assert.equal(applySelfHostedArtwork(games, null), games);
    assert.equal(applySelfHostedArtwork(games, new Map()), games);
  });
});
