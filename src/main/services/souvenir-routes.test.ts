import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  forgetSouvenirSources,
  isOfficialSouvenirProfile,
  isSouvenirRoute,
  rememberSouvenirSource,
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
