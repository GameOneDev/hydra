import type { SouvenirSort, SouvenirsResponse } from "@types";

import { buildUserSouvenirsPath } from "@shared";
import {
  ACHIEVEMENT_SOUVENIRS_FEATURE,
  HydraApi,
  rememberSouvenirSource,
} from "@main/services";
import { logger } from "@main/services/logger";

import { registerEvent } from "../register-event";

interface ProfileSouvenirsPayload {
  userId: string;
  take?: number;
  skip?: number;
  sortBy?: SouvenirSort;
  language?: string;
}

/**
 * A profile's souvenirs, read from whichever server its owner captured them on.
 *
 * The self-hosted server is asked first — on a self-hosted deployment most
 * profiles are its own members, so that is one request for the common case. It
 * answers `isMember: false` for a profile it has never seen, and those keep
 * their souvenirs on official Hydra, so the launcher asks there instead.
 *
 * Asking official first would not work: upstream defaults an account's souvenir
 * privacy to PRIVATE, so a non-subscriber's profile can answer "hidden" rather
 * than "empty", and the launcher would render a locked tab and never fall back.
 *
 * Whichever server answers is remembered for the profile, so the likes and
 * reports that follow go to the same place.
 */
const getProfileSouvenirs = async (
  _event: Electron.IpcMainInvokeEvent,
  { userId, take, skip, sortBy, language }: ProfileSouvenirsPayload
) => {
  const path = buildUserSouvenirsPath({ userId, take, skip, sortBy, language });
  const options = { needsAuth: HydraApi.isLoggedIn() };

  const selfHosted =
    HydraApi.isSelfHostedCloudEnabled() &&
    HydraApi.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE);

  if (!selfHosted) {
    rememberSouvenirSource(userId, "official");
    return HydraApi.get<SouvenirsResponse | null>(path, undefined, options);
  }

  const response = await HydraApi.get<SouvenirsResponse | null>(
    path,
    undefined,
    options
  );

  /* A server predating `isMember` can't say, so fall back on the shape of its
     answer: nothing to show and nothing hidden reads as "not this server's
     profile". */
  const knowsProfile =
    response?.isMember ??
    Boolean(response && (response.total > 0 || response.hiddenReason !== null));

  if (knowsProfile) {
    rememberSouvenirSource(userId, "cloud");
    return response;
  }

  /* Remembered before the call so the request routes to official, and so the
     likes and reports that follow this page go there too. */
  rememberSouvenirSource(userId, "official");

  return HydraApi.get<SouvenirsResponse | null>(path, undefined, options).catch(
    (error) => {
      logger.error("Failed to read souvenirs from the official API", error);
      return response;
    }
  );
};

registerEvent("getProfileSouvenirs", getProfileSouvenirs);
