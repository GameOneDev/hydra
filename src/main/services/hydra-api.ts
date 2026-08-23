import axios, { AxiosError, AxiosInstance } from "axios";
import { WindowManager } from "./window-manager";
import url from "url";
import { uploadGamesBatch } from "./library-sync";
import { clearGamesRemoteIds } from "./library-sync/clear-games-remote-id";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError, SubscriptionRequiredError } from "@shared";
import { appVersion } from "@main/constants";
import { getUserData } from "./user/get-user-data";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type {
  Auth,
  SelfHostedServerProbe,
  SelfHostedServerStatus,
  User,
  UserPreferences,
} from "@types";
import { SSEClient } from "./sse";
import {
  sanitizeAxiosError,
  sanitizeNetworkLogPayload,
} from "./network-log-payload";
import {
  disabledSelfHostedServerStatus,
  normalizeSelfHostedUrl,
  probeSelfHostedServer,
  resolveSelfHostedServerStatus,
} from "./self-hosted/probe-self-hosted-server";
import {
  ACHIEVEMENT_SOUVENIRS_FEATURE,
  forgetSouvenirSources,
  isOfficialSouvenirProfile,
  isSouvenirRoute,
} from "./souvenir-routes";

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
}

interface HydraApiUserAuth {
  authToken: string;
  refreshToken: string;
  expirationTimestamp: number;
  subscription: { expiresAt: Date | string | null } | null;
}

export class HydraApi {
  private static instance: AxiosInstance;

  private static readonly EXPIRATION_OFFSET_IN_MS = 1000 * 60 * 5; // 5 minutes
  private static readonly ADD_LOG_INTERCEPTOR = true;

  private static secondsToMilliseconds(seconds: number) {
    return seconds * 1000;
  }

  private static userAuth: HydraApiUserAuth = {
    authToken: "",
    refreshToken: "",
    expirationTimestamp: 0,
    subscription: null,
  };

  /* Self-hosted cloud storage server. Accounts, friends, catalogue and every
     other route keep using the official API — only the subscription-gated
     features below are re-routed, authenticated with the same official
     access token (the self-hosted server validates it against the official
     API to identify the user). */
  private static cloudInstance: AxiosInstance | null = null;
  private static selfHostedCloudUrl: string | null = null;

  /* Features the configured self-hosted server reports at /capabilities,
     plus the URL they were read from. `null` means "not known yet or the
     server didn't answer" — treated as supporting nothing, so a feature is
     only enabled once the server has actually claimed it. Capabilities read
     from another URL never gate the current server, which is what the URL
     alongside them is for. */
  private static selfHostedFeatures: Set<string> | null = null;
  private static selfHostedVersion: string | null = null;
  private static selfHostedCapabilitiesUrl: string | null = null;

  private static clearSelfHostedCapabilities() {
    this.selfHostedFeatures = null;
    this.selfHostedVersion = null;
    this.selfHostedCapabilitiesUrl = null;
  }

  private static storeSelfHostedCapabilities(
    url: string,
    probe: SelfHostedServerProbe
  ) {
    this.selfHostedFeatures = new Set(probe.features);
    this.selfHostedVersion = probe.version;
    this.selfHostedCapabilitiesUrl = url;
  }

  /* Whether what we last read still describes the server we are routing to. */
  private static hasCapabilitiesForCurrentServer() {
    return (
      this.selfHostedCapabilitiesUrl !== null &&
      this.selfHostedCapabilitiesUrl === this.selfHostedCloudUrl
    );
  }

  /* Last known reachability of the configured server, rendered by the
     launcher's status indicator and the settings page. */
  private static selfHostedStatus: SelfHostedServerStatus =
    disabledSelfHostedServerStatus();

  private static readonly CLOUD_ROUTED_PREFIXES = [
    "/profile/games/artifacts",
    "/profile/hidden-games",
    /* Custom game images (covers, icons, logos, banners). Uploads already
       route here via needsSubscription; the read side has no such flag, and
       these listing endpoints only exist on the self-hosted server. */
    "/profile/games/artwork",
    "/profile/emulation-saves",
    "/profile/download-sources",
    /* Banner fallback lookup/removal — these endpoints only exist on the
       self-hosted server ("/profile/banner" also matches
       "/profile/banners/{userId}"). */
    "/profile/banner",
    /* Achievement-count fallback for profile stats the official API only
       computes for subscribers */
    "/profile/stats",
    /* Recently unlocked achievements for a profile. Deliberately not under
       "/profile/games/achievements": the sync mirrors that path to BOTH this
       server and the official API, and routing the prefix would swallow the
       official half. */
    "/profile/achievements",
    /* Daily playtime buckets for the profile heatmap — only exists on the
       self-hosted server */
    "/profile/playtime",
    /* Same-server membership lookup for the profile badge — only exists on
       the self-hosted server */
    "/profile/members",
  ];

  /* Banner uploads are subscription-gated on the official API. With a REAL
     subscription they keep going to the official CDN; without one the
     self-hosted server stores and serves the image, and the resulting URL
     is still saved to the official profile. */
  private static readonly CLOUD_FALLBACK_PREFIXES = [
    "/presigned-urls/background-image",
  ];

  /* Subscriber-only services that are NOT storage and only the official API
     can perform, even though they carry needsSubscription. Hoster unlocking
     resolves a download link through Hydra's own credentials with that
     file host — nothing a self-hosted server could stand in for. */
  private static readonly OFFICIAL_ONLY_PREFIXES = ["/hosters/"];

  /* Expiration of the user's real official subscription, unaffected by the
     synthetic self-hosted one injected into user data. */
  private static realSubscriptionExpiresAt: Date | null = null;

  public static syncRealSubscription(
    subscription: { expiresAt: Date | string | null } | null
  ) {
    this.realSubscriptionExpiresAt = subscription?.expiresAt
      ? new Date(subscription.expiresAt)
      : null;
  }

  private static hasRealActiveSubscription() {
    return (
      this.realSubscriptionExpiresAt !== null &&
      this.realSubscriptionExpiresAt > new Date()
    );
  }

  private static normalizeUrl(url?: string | null) {
    return normalizeSelfHostedUrl(url);
  }

  public static isSelfHostedCloudEnabled() {
    return this.selfHostedCloudUrl !== null;
  }

  public static getSelfHostedCloudUrl() {
    return this.selfHostedCloudUrl;
  }

  public static getSelfHostedVersion() {
    return this.hasCapabilitiesForCurrentServer()
      ? this.selfHostedVersion
      : null;
  }

  public static getSelfHostedStatus() {
    return this.selfHostedStatus;
  }

  private static setSelfHostedStatus(status: SelfHostedServerStatus) {
    this.selfHostedStatus = status;

    WindowManager.sendToAppWindows("on-self-hosted-status-updated", status);
  }

  /**
   * Re-reads the configured server's capabilities and reachability, pushing
   * the result to every window. Called when the URL changes, by the periodic
   * status monitor, and whenever the user asks for a re-check.
   */
  public static async refreshSelfHostedStatus() {
    await this.refreshSelfHostedCapabilities();
    return this.selfHostedStatus;
  }

  /**
   * Whether the cloud server backing the subscription-gated features supports
   * `feature`.
   *
   * Without a self-hosted server everything runs against official Hydra
   * Cloud, which by definition implements whatever the launcher ships. With
   * one configured we only enable a feature the server has actually
   * advertised: the launcher routes these calls to it, and upstream keeps
   * adding endpoints that a self-hosted deployment may not have yet. Failing
   * closed turns "silently broken mid-sync" into "feature stays off".
   */
  public static supportsCloudFeature(feature: string) {
    if (!this.isSelfHostedCloudEnabled()) return true;
    if (!this.hasCapabilitiesForCurrentServer()) return false;
    return this.selfHostedFeatures?.has(feature) ?? false;
  }

  /**
   * Hidden games are stored on the self-hosted server, so the feature needs an
   * authenticated session against one that advertises it. Both renderers gate
   * their UI on this, and the hide/unhide handlers enforce it.
   */
  public static supportsHiddenGames() {
    return (
      this.isLoggedIn() &&
      this.isSelfHostedCloudEnabled() &&
      this.supportsCloudFeature("hidden-games")
    );
  }

  /**
   * Reads /capabilities from the self-hosted server. Unauthenticated and
   * cheap, so it runs on every setup, whenever the URL changes, and on the
   * status monitor's tick.
   *
   * Anything other than a capabilities payload — a 404 from a server
   * predating the endpoint, a URL that isn't Hydra Cloud, an unreachable
   * host — leaves the feature set empty, which is exactly the conservative
   * answer we want. The probe result doubles as the status the UI shows.
   *
   * A re-check of a server we already have an answer for keeps that answer
   * until the new one lands: the probe can take ten seconds, and nothing
   * gated on the server should read as unsupported meanwhile.
   */
  private static async refreshSelfHostedCapabilities() {
    const baseUrl = this.selfHostedCloudUrl;

    if (!baseUrl) {
      this.clearSelfHostedCapabilities();
      this.setSelfHostedStatus(disabledSelfHostedServerStatus());
      return;
    }

    /* Capabilities belonging to a different server say nothing about this
       one, so those go before the probe. What we already know about THIS
       server stays live until the probe answers: a probe takes up to ten
       seconds, and dropping the feature set for that long on every monitor
       tick would disable hidden games, cloud saves and souvenirs — or route
       them back to the official API — on a server that never stopped being
       healthy. */
    if (!this.hasCapabilitiesForCurrentServer()) {
      this.clearSelfHostedCapabilities();
    }

    /* Only announce "checking" when there is nothing better to show — a
       periodic re-check of a server already known to be up shouldn't make the
       indicator flicker every minute. */
    const hasResultForThisServer =
      this.selfHostedStatus.url === baseUrl &&
      this.selfHostedStatus.checkedAt !== null;

    if (!hasResultForThisServer) {
      this.setSelfHostedStatus({
        ...disabledSelfHostedServerStatus(),
        url: baseUrl,
        state: "checking",
      });
    }

    const probe = await probeSelfHostedServer(baseUrl, {
      userAgent: `Hydra Launcher v${appVersion}`,
    });

    if (this.selfHostedCloudUrl !== baseUrl) return;

    if (probe.error === null) {
      this.storeSelfHostedCapabilities(baseUrl, probe);

      logger.log(
        "self-hosted cloud server",
        probe.name ?? "unknown server",
        this.selfHostedVersion ?? "unknown version",
        `${probe.latencyInMs}ms`,
        probe.features.join(", ")
      );
    } else {
      /* The probe has spoken: whatever we were still holding from the last
         successful one no longer describes a server we can reach, so the
         gating falls back closed. */
      this.clearSelfHostedCapabilities();

      logger.error(
        "self-hosted cloud server probe failed — features gated on it stay disabled",
        probe.error
      );
    }

    this.setSelfHostedStatus(
      resolveSelfHostedServerStatus(baseUrl, probe, Date.now())
    );
  }

  /**
   * Probes an arbitrary URL without touching the configured server, so the
   * settings page can tell the user whether a URL works BEFORE they commit to
   * it — the whole point being to not need a relaunch to find out.
   */
  public static async testSelfHostedServer(
    url: string
  ): Promise<SelfHostedServerProbe> {
    const baseUrl = this.normalizeUrl(url);

    if (!baseUrl) {
      return {
        reachable: false,
        statusCode: null,
        latencyInMs: null,
        name: null,
        status: null,
        version: null,
        features: [],
        error: "EMPTY_URL",
      };
    }

    return probeSelfHostedServer(baseUrl, {
      userAgent: `Hydra Launcher v${appVersion}`,
    });
  }

  private static resolveInstance(url: string, options?: HydraApiOptions) {
    if (!this.cloudInstance) return this.instance;

    /* `needsSubscription` normally means "storage feature" and routes here,
       but upstream also uses the flag for subscriber-only services the
       official API alone provides. Those must never be re-routed: a
       self-hosted storage server has no way to unlock a file host. */
    if (this.OFFICIAL_ONLY_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return this.instance;
    }

    /* The upload and the profile listing it have to agree on where souvenirs
       live, so a server without the endpoints keeps the whole feature on the
       official API rather than 404ing halfway through a capture. */
    if (isSouvenirRoute(url)) {
      /* A profile whose souvenirs came from official Hydra keeps its likes
         and reports there too. */
      if (isOfficialSouvenirProfile(url)) return this.instance;

      return this.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE)
        ? this.cloudInstance
        : this.instance;
    }

    const isCloudRoute =
      options?.needsSubscription === true ||
      this.CLOUD_ROUTED_PREFIXES.some((prefix) => url.startsWith(prefix)) ||
      (!this.hasRealActiveSubscription() &&
        this.CLOUD_FALLBACK_PREFIXES.some((prefix) => url.startsWith(prefix)));

    return isCloudRoute ? this.cloudInstance : this.instance;
  }

  public static isLoggedIn() {
    return this.userAuth.authToken !== "";
  }

  /**
   * Upstream only asks whether the account has Hydra Cloud. With a self-hosted
   * server standing in for the subscription, the question is also whether
   * *that* server has the endpoints — capturing screenshots whose sync can
   * only 404 fills the retry queue with work that can never finish.
   */
  public static supportsAchievementSouvenirs() {
    return (
      this.hasActiveSubscription() &&
      this.supportsCloudFeature(ACHIEVEMENT_SOUVENIRS_FEATURE)
    );
  }

  public static hasActiveSubscription() {
    /* The self-hosted server provides the subscription-gated features, so
       having one configured counts as an active subscription. */
    if (this.isSelfHostedCloudEnabled()) return true;

    const expiresAt = new Date(this.userAuth.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
  }

  public static updateUserSubscription(
    subscription?: { expiresAt: Date | string | null } | null
  ) {
    this.userAuth.subscription = subscription
      ? { expiresAt: subscription.expiresAt }
      : null;

    if (process.platform === "linux" && !this.hasActiveSubscription()) {
      void import("./linux-game-capture-session").then(
        ({ stopAllLinuxGameCaptureSessions }) => {
          if (!this.hasActiveSubscription()) {
            stopAllLinuxGameCaptureSessions();
          }
        }
      );
    }

    if (this.isLoggedIn() && this.hasActiveSubscription()) {
      void import("./achievements/grouped-souvenir-worker").then(
        ({ groupedSouvenirWorker }) => groupedSouvenirWorker.trigger()
      );
    }
  }

  static async handleExternalAuth(uri: string) {
    const { payload } = url.parse(uri, true).query;

    const decodedBase64 = atob(payload as string);
    const jsonData = JSON.parse(decodedBase64);

    const { accessToken, expiresIn, refreshToken, workwondersJwt } = jsonData;

    const now = new Date();

    const tokenExpirationTimestamp =
      now.getTime() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth = {
      authToken: accessToken,
      refreshToken: refreshToken,
      expirationTimestamp: tokenExpirationTimestamp,
      subscription: null,
    };

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();

    logger.log(
      "Sign in received. Token expiration timestamp:",
      tokenExpirationTimestamp
    );

    db.put<string, Auth>(
      levelKeys.auth,
      {
        accessToken,
        refreshToken,
        tokenExpirationTimestamp,
        workwondersJwt,
      },
      { valueEncoding: "json" }
    );

    await getUserData().then((userDetails) => {
      if (userDetails?.subscription) {
        this.updateUserSubscription({
          expiresAt: userDetails.subscription.expiresAt
            ? new Date(userDetails.subscription.expiresAt)
            : null,
        });
      }
    });

    const { groupedSouvenirWorker } = await import(
      "./achievements/grouped-souvenir-worker"
    );
    void groupedSouvenirWorker.trigger();

    if (WindowManager.mainWindow) {
      WindowManager.mainWindow.webContents.send("on-signin");
      await clearGamesRemoteIds();
      void uploadGamesBatch();

      SSEClient.close();
      SSEClient.connect();

      const { syncDownloadSourcesFromApi } = await import("./user");
      syncDownloadSourcesFromApi();
    }
  }

  /* The official session is untouched when the self-hosted cloud URL
     changes — only the cloud axios instance needs rebuilding, and the user
     data refresh re-applies (or removes) the synthetic subscription.

     Re-running the cloud-dependent startup work here is what makes the new
     URL take effect without a relaunch: renderers reload the user (the
     self-hosted subscription perks live on it) and the capability-gated UI,
     the library re-syncs against the new server, and download sources are
     pulled from it again. */
  static async handleCloudServerChange() {
    forgetSouvenirSources();
    await this.setupApi();

    WindowManager.sendToAppWindows(
      "on-cloud-server-changed",
      this.selfHostedStatus
    );

    /* The V2 default migration is skipped while the cloud server can't serve
       V2, and used to only get another chance on the next launch. */
    const { migrateCloudSaveAutomaticSyncDefaults } = await import(
      "./cloud-save"
    );
    await migrateCloudSaveAutomaticSyncDefaults().catch((err) =>
      logger.error("failed to migrate cloud save defaults", err)
    );

    if (!this.isLoggedIn()) return;

    void uploadGamesBatch();

    const { syncDownloadSourcesFromApi } = await import("./user");
    void syncDownloadSourcesFromApi();
  }

  static async handleSignOut() {
    forgetSouvenirSources();

    this.userAuth = {
      authToken: "",
      refreshToken: "",
      expirationTimestamp: 0,
      subscription: null,
    };

    const { AchievementWatcherManager } = await import(
      "./achievements/achievement-watcher-manager"
    );
    AchievementWatcherManager.resetSessionState();
    const { stopAllLinuxGameCaptureSessions } = await import(
      "./linux-game-capture-session"
    );
    stopAllLinuxGameCaptureSessions();
    const { groupedSouvenirWorker } = await import(
      "./achievements/grouped-souvenir-worker"
    );
    groupedSouvenirWorker.stop();

    this.sendSignOutEvent();
    this.post("/auth/logout", {}, { needsAuth: false }).catch(() => {});
  }

  static async setupApi() {
    const userPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    this.selfHostedCloudUrl = this.normalizeUrl(
      userPreferences?.selfHostedCloudUrl
    );

    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
    });

    this.cloudInstance = this.selfHostedCloudUrl
      ? axios.create({
          baseURL: this.selfHostedCloudUrl,
          headers: { "User-Agent": `Hydra Launcher v${appVersion}` },
        })
      : null;

    await this.refreshSelfHostedCapabilities();

    if (this.ADD_LOG_INTERCEPTOR) {
      this.instance.interceptors.request.use(
        (request) => {
          logger.log(" ---- REQUEST -----");
          logger.log(
            request.method,
            request.url,
            sanitizeNetworkLogPayload({
              params: request.params ?? null,
              data: request.data ?? null,
            })
          );
          return request;
        },
        (error) => {
          logger.error("request error", error);
          return Promise.reject(error);
        }
      );
      this.instance.interceptors.response.use(
        (response) => {
          logger.log(" ---- RESPONSE -----");
          logger.log(
            response.status,
            response.config.method,
            response.config.url,
            sanitizeNetworkLogPayload(response.data)
          );
          return response;
        },
        (error) => {
          logger.error(" ---- RESPONSE ERROR -----");
          const config = error.config ?? {};

          logger.error(
            config.method,
            config.baseURL,
            config.url,
            sanitizeNetworkLogPayload({
              headers: config.headers ?? null,
              data: config.data ?? null,
            })
          );
          if (error.response) {
            logger.error(
              "Response error:",
              error.response.status,
              sanitizeNetworkLogPayload(error.response.data)
            );

            return Promise.reject(error as Error);
          }

          if (error.request) {
            const errorData = error.toJSON();
            logger.error("Request error:", errorData.code, errorData.message);
            return Promise.reject(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              )
            );
          }

          logger.error("Error", error.message);
          return Promise.reject(error as Error);
        }
      );
    }

    const result = await db.getMany<string>([levelKeys.auth, levelKeys.user], {
      valueEncoding: "json",
    });

    const userAuth = result.at(0) as Auth | undefined;
    const user = result.at(1) as User | undefined;

    this.userAuth = {
      authToken: userAuth?.accessToken ?? "",
      refreshToken: userAuth?.refreshToken ?? "",
      expirationTimestamp: userAuth?.tokenExpirationTimestamp ?? 0,
      subscription: user?.subscription
        ? { expiresAt: user.subscription?.expiresAt }
        : null,
    };

    const updatedUserData = await getUserData();

    this.updateUserSubscription(updatedUserData?.subscription);
  }

  private static sendSignOutEvent() {
    WindowManager.sendToAppWindows("on-signout");
  }

  public static async refreshToken() {
    const response = await this.instance.post(`/auth/refresh`, {
      refreshToken: this.userAuth.refreshToken,
    });

    const { accessToken, expiresIn } = response.data;

    const tokenExpirationTimestamp =
      Date.now() +
      this.secondsToMilliseconds(expiresIn) -
      this.EXPIRATION_OFFSET_IN_MS;

    this.userAuth.authToken = accessToken;
    this.userAuth.expirationTimestamp = tokenExpirationTimestamp;

    logger.log(
      "Token refreshed. New expiration:",
      this.userAuth.expirationTimestamp
    );

    await db
      .get<string, Auth>(levelKeys.auth, { valueEncoding: "json" })
      .then((auth) => {
        return db.put<string, Auth>(
          levelKeys.auth,
          {
            ...auth,
            accessToken,
            tokenExpirationTimestamp,
          },
          { valueEncoding: "json" }
        );
      });

    return { accessToken, expiresIn };
  }

  private static async revalidateAccessTokenIfExpired() {
    if (this.userAuth.expirationTimestamp < Date.now()) {
      try {
        await this.refreshToken();
      } catch (err) {
        await this.handleUnauthorizedError(err);
      }
    }
  }

  private static getAxiosConfig() {
    return {
      headers: {
        Authorization: `Bearer ${this.userAuth.authToken}`,
      },
    };
  }

  private static readonly handleUnauthorizedError = async (err) => {
    sanitizeAxiosError(err);

    if (err instanceof AxiosError && err.response?.status === 401) {
      logger.error(
        "401 - Current credentials:",
        sanitizeNetworkLogPayload({
          credentials: this.userAuth,
          response: err.response?.data,
        })
      );

      this.userAuth = {
        authToken: "",
        expirationTimestamp: 0,
        refreshToken: "",
        subscription: null,
      };

      const { AchievementWatcherManager } = await import(
        "./achievements/achievement-watcher-manager"
      );
      AchievementWatcherManager.resetSessionState();

      const { stopAllLinuxGameCaptureSessions } = await import(
        "./linux-game-capture-session"
      );
      stopAllLinuxGameCaptureSessions();
      const { groupedSouvenirWorker } = await import(
        "./achievements/grouped-souvenir-worker"
      );
      groupedSouvenirWorker.stop();

      db.batch([
        {
          type: "del",
          key: levelKeys.auth,
        },
        {
          type: "del",
          key: levelKeys.user,
        },
      ]);

      SSEClient.close();
      this.sendSignOutEvent();
    }

    throw err;
  };

  private static async validateOptions(options?: HydraApiOptions) {
    const needsAuth = options?.needsAuth == undefined || options.needsAuth;
    const needsSubscription = options?.needsSubscription === true;

    if (needsAuth) {
      if (!this.isLoggedIn()) throw new UserNotLoggedInError();
      await this.revalidateAccessTokenIfExpired();
    }

    if (needsSubscription && !this.hasActiveSubscription()) {
      await this.refreshUserSubscription();

      if (!this.hasActiveSubscription()) {
        throw new SubscriptionRequiredError();
      }
    }
  }

  private static async refreshUserSubscription() {
    if (!this.isLoggedIn()) return;

    try {
      const userDetails = await getUserData();
      if (userDetails) this.updateUserSubscription(userDetails.subscription);
    } catch (err) {
      logger.error("Failed to refresh subscription state", err);
    }
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.resolveInstance(url, options)
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    const headers = {
      ...this.getAxiosConfig().headers,
      "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
      "If-None-Match": options?.ifNoneMatch,
    };

    return this.resolveInstance(url, options)
      .get<T>(url, {
        params,
        ...this.getAxiosConfig(),
        headers,
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
        headers: response.headers,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.resolveInstance(url, options)
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.instance
      .post<T>(url, data, {
        ...this.getAxiosConfig(),
        validateStatus: options?.validateStatus,
        signal: options?.signal,
      })
      .then((response) => ({
        status: response.status,
        data: response.data,
      }))
      .catch(this.handleUnauthorizedError);
  }

  static async put<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.resolveInstance(url, options)
      .put<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async patch<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    await this.validateOptions(options);

    return this.resolveInstance(url, options)
      .patch<T>(url, data, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async delete<T = any>(url: string, options?: HydraApiOptions) {
    await this.validateOptions(options);

    return this.resolveInstance(url, options)
      .delete<T>(url, {
        ...this.getAxiosConfig(),
        signal: options?.signal,
      })
      .then((response) => response.data)
      .catch(this.handleUnauthorizedError);
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    logger.info("HydraApi.checkDownloadSourcesChanges called with:", {
      downloadSourceIds,
      gamesCount: games.length,
      since,
      isLoggedIn: this.isLoggedIn(),
    });

    try {
      const result = await this.post<
        Array<{
          shop: string;
          objectId: string;
          newDownloadOptionsCount: number;
          downloadSourceIds: string[];
        }>
      >(
        "/download-sources/changes",
        {
          downloadSourceIds,
          games,
          since,
        },
        { needsAuth: true }
      );

      logger.info(
        "HydraApi.checkDownloadSourcesChanges completed successfully:",
        result
      );
      return result;
    } catch (error) {
      logger.error("HydraApi.checkDownloadSourcesChanges failed:", error);
      throw error;
    }
  }
}
