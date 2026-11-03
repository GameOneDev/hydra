import type { User, UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import { mirrorSouvenirsVisibility } from "../souvenir-visibility-mirror";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { HydraApiAuthContext } from "../hydra-auth-context";

/* With a self-hosted cloud server configured, the subscription-gated
   features are provided by that server, so a synthetic always-active
   subscription is injected for accounts without a real one. Everything else
   in the user data comes from the official API untouched. */
const applySelfHostedCloudPerks = (me: UserDetails): UserDetails => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return me;

  const hasRealSubscription =
    me.subscription?.expiresAt &&
    new Date(me.subscription.expiresAt) > new Date();

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 100);

  return {
    ...me,
    subscription: hasRealSubscription
      ? me.subscription
      : {
          id: "self-hosted",
          status: "active",
          plan: { id: "self-hosted", name: "Self-hosted" },
          expiresAt: expiresAt.toISOString(),
          paymentMethod: "pix",
        },
    quirks: {
      ...me.quirks,
      backupsPerGameLimit: Math.max(me.quirks?.backupsPerGameLimit ?? 0, 100),
    },
  };
};

const getCachedUserData = async (
  context: HydraApiAuthContext
): Promise<UserDetails | null> => {
  try {
    const user = await db.get<string, User>(levelKeys.user, {
      valueEncoding: "json",
    });
    if (!HydraApi.isAuthContextCurrent(context) || user?.id !== context.userId)
      return null;
    return {
      ...user,
      username: "",
      bio: "",
      email: null,
      profileVisibility: "PUBLIC",
      souvenirsVisibility: "PRIVATE",
      quirks: { backupsPerGameLimit: 0 },
      subscription: user.subscription
        ? {
            id: user.subscription.id,
            status: user.subscription.status,
            plan: {
              id: user.subscription.plan.id,
              name: user.subscription.plan.name,
            },
            expiresAt: user.subscription.expiresAt,
          }
        : null,
    } as UserDetails;
  } catch {
    if (HydraApi.isAuthContextCurrent(context))
      logger.error("Failed to read user from DB");
    return null;
  }
};

export const getUserData = async (options?: {
  allowCached?: boolean;
  triggerSouvenirSync?: boolean;
}): Promise<UserDetails | null> => {
  const context = HydraApi.getAuthContext();
  if (!context || !HydraApi.isAuthContextCurrent(context)) return null;

  let remoteMe: UserDetails;
  try {
    remoteMe = await HydraApi.get<UserDetails>("/profile/me", undefined, {
      authContext: context,
    });
  } catch (error) {
    if (
      !HydraApi.isAuthContextCurrent(context) ||
      error instanceof UserNotLoggedInError
    ) {
      return null;
    }
    logger.error("Failed to get logged user");
    if (options?.allowCached === false) return null;
    return getCachedUserData(context);
  }

  if (!HydraApi.isAuthContextCurrent(context) || remoteMe.id !== context.userId)
    return null;

  /* Record the REAL subscription before injecting the synthetic one so
     routing can distinguish actual Hydra Cloud subscribers. */
  HydraApi.syncRealSubscription(remoteMe.subscription);

  const me = applySelfHostedCloudPerks(remoteMe);

  /* The self-hosted server can't read this account's official profile, so
     it only knows the souvenir privacy setting because the launcher tells
     it — including on a machine that never changed it. */
  mirrorSouvenirsVisibility(remoteMe.id, remoteMe.souvenirsVisibility);

  try {
    const cached = await db.get<string, User>(levelKeys.user, {
      valueEncoding: "json",
    });
    if (!HydraApi.isAuthContextCurrent(context)) return null;
    await HydraApi.persistUserCache(
      {
        ...cached,
        id: me.id,
        displayName: me.displayName,
        profileImageUrl: me.profileImageUrl,
        backgroundImageUrl: me.backgroundImageUrl,
        subscription: me.subscription,
      },
      context
    );
  } catch {
    if (!HydraApi.isAuthContextCurrent(context)) return null;
    logger.error("Failed to update user in DB");
  }

  if (!HydraApi.isAuthContextCurrent(context)) return null;
  HydraApi.updateUserSubscription(me.subscription, {
    freshUserId: me.id,
    triggerSouvenirSync: options?.triggerSouvenirSync,
  });
  return me;
};
