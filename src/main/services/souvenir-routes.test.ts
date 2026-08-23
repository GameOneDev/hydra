import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  forgetSouvenirSources,
  isOfficialSouvenirProfile,
  isSouvenirRoute,
  rememberSouvenirSource,
  shouldReadSouvenirsFromOfficial,
} from "./souvenir-routes.js";

describe("souvenir cloud routing", () => {
  it("routes the souvenir endpoints", () => {
    for (const url of [
      "/presigned-urls/achievement-image",
      "/profile/souvenirs/abc-123",
      "/profile/souvenirs/abc-123/visibility",
      "/profile/souvenirs-visibility",
      "/users/user-1/souvenirs",
      "/users/user-1/souvenirs?take=24&skip=0&sortBy=recent&shop=steam",
      "/users/user-1/souvenirs/abc-123/like",
      "/users/user-1/souvenirs/abc-123/report",
      "/users/user-1/games/achievements",
    ]) {
      assert.equal(isSouvenirRoute(url), true, url);
    }
  });

  /* Every one of these has a souvenir route as a near-prefix, and sending it
     to a self-hosted storage server would break a feature that has nothing to
     do with souvenirs. */
  it("leaves the rest of the official API alone", () => {
    for (const url of [
      "/presigned-urls/background-image",
      "/presigned-urls/profile-image",
      "/profile",
      "/profile/games/achievements",
      "/profile/games/artifacts",
      "/users/user-1",
      "/users/user-1/games/achievements/compare",
      "/users/user-1/games/achievements/compare?shop=steam",
      "/users/user-1/library",
      "/users/user-1/stats",
    ]) {
      assert.equal(isSouvenirRoute(url), false, url);
    }
  });
});

describe("souvenir source per profile", () => {
  it("sends nothing to official until a profile is known to live there", () => {
    forgetSouvenirSources();

    assert.equal(isOfficialSouvenirProfile("/users/u1/souvenirs"), false);
  });

  it("keeps a profile's likes and reports on the server that listed it", () => {
    forgetSouvenirSources();
    rememberSouvenirSource("u1", "official");

    for (const url of [
      "/users/u1/souvenirs",
      "/users/u1/souvenirs?take=24",
      "/users/u1/souvenirs/abc/like",
      "/users/u1/souvenirs/abc/report",
    ]) {
      assert.equal(isOfficialSouvenirProfile(url), true, url);
    }

    /* Another profile is unaffected — the answer is per owner, not global. */
    assert.equal(isOfficialSouvenirProfile("/users/u2/souvenirs"), false);
  });

  it("reads a profile id that arrived percent-encoded", () => {
    forgetSouvenirSources();
    rememberSouvenirSource("user one", "official");

    assert.equal(
      isOfficialSouvenirProfile("/users/user%20one/souvenirs"),
      true
    );
  });

  it("goes back to asking the self-hosted server once cleared", () => {
    rememberSouvenirSource("u1", "official");
    forgetSouvenirSources();

    assert.equal(isOfficialSouvenirProfile("/users/u1/souvenirs"), false);
  });
});

describe("falling back to official Hydra", () => {
  /* Emptiness decides, not membership: a member can have souvenirs on official
     and none here — from before they joined, or from a machine still pointed
     at it. */
  it("asks official when the self-hosted server has nothing to show", () => {
    assert.equal(
      shouldReadSouvenirsFromOfficial({ items: [], hiddenReason: null }, 0),
      true
    );
  });

  it("keeps a page it got answers for", () => {
    assert.equal(
      shouldReadSouvenirsFromOfficial({ items: [{}], hiddenReason: null }, 0),
      false
    );
  });

  /* Hidden is a privacy decision, not an absence — reading official instead
     would show what the owner asked us not to. */
  it("leaves a hidden tab hidden", () => {
    assert.equal(
      shouldReadSouvenirsFromOfficial(
        { items: [], hiddenReason: "PRIVATE" },
        0
      ),
      false
    );
  });

  /* Otherwise loadMore would splice official's page two onto a list from
     here. */
  it("only switches source on the first page", () => {
    assert.equal(
      shouldReadSouvenirsFromOfficial({ items: [], hiddenReason: null }, 24),
      false
    );
  });

  it("asks official when the self-hosted server answered with nothing", () => {
    assert.equal(shouldReadSouvenirsFromOfficial(null, 0), true);
  });
});
