import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useUserDetails } from "@renderer/hooks";
import { Avatar } from "../avatar/avatar";
import type { ProfileFriends, UserFriend } from "@types";

import "./online-friends-bar.scss";

const FRIENDS_PAGE_SIZE = 50;

export function OnlineFriendsBar() {
  const { t } = useTranslation("header");
  const navigate = useNavigate();

  const { userDetails } = useUserDetails();

  const [onlineFriends, setOnlineFriends] = useState<UserFriend[]>([]);

  const fetchOnlineFriends = useCallback(async () => {
    if (!userDetails) {
      setOnlineFriends([]);
      return;
    }

    try {
      const response = await window.electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: FRIENDS_PAGE_SIZE, skip: 0 } }
      );

      setOnlineFriends(response.friends.filter((friend) => friend.isOnline));
    } catch {
      // ignore transient errors; the next refresh will retry
    }
  }, [userDetails]);

  useEffect(() => {
    fetchOnlineFriends();

    const unsubscribeFriends = window.electron.onFriendsUpdated(() => {
      fetchOnlineFriends();
    });

    let interval: ReturnType<typeof setInterval> | null = null;
    const unsubscribePresence =
      typeof window.electron.onFriendPresence === "function"
        ? window.electron.onFriendPresence(() => {
            fetchOnlineFriends();
          })
        : () => {
            if (interval) clearInterval(interval);
          };

    if (typeof window.electron.onFriendPresence !== "function") {
      interval = setInterval(fetchOnlineFriends, 30_000);
    }

    return () => {
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [fetchOnlineFriends]);

  const formatSessionDuration = (seconds: number) => {
    const totalMinutes = Math.max(1, Math.floor(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) return t("session_duration_hours", { hours, minutes });
    return t("session_duration_minutes", { minutes });
  };

  const friendTooltip = (friend: UserFriend) => {
    if (!friend.currentGame) return friend.displayName;

    if (friend.currentGame.sessionDurationInSeconds > 0) {
      return t("online_friend_playing_for", {
        displayName: friend.displayName,
        title: friend.currentGame.title,
        duration: formatSessionDuration(
          friend.currentGame.sessionDurationInSeconds
        ),
      });
    }

    return t("online_friend_playing", {
      displayName: friend.displayName,
      title: friend.currentGame.title,
    });
  };

  if (!userDetails || onlineFriends.length === 0) return null;

  return (
    <ul className="online-friends-bar">
      {onlineFriends.map((friend) => (
        <li key={friend.id} className="online-friends-bar__item">
          <button
            type="button"
            className="online-friends-bar__friend"
            onClick={() => navigate(`/profile/${friend.id}`)}
            title={friendTooltip(friend)}
          >
            <div className="online-friends-bar__avatar">
              <Avatar
                size={18}
                src={friend.profileImageUrl}
                alt={friend.displayName}
              />
              <span className="online-friends-bar__status-dot" />
            </div>

            <span className="online-friends-bar__name">
              {friend.displayName}
            </span>

            {friend.currentGame && (
              <span className="online-friends-bar__game">
                {friend.currentGame.iconUrl && (
                  <img
                    className="online-friends-bar__game-icon"
                    src={friend.currentGame.iconUrl}
                    alt=""
                  />
                )}
                {friend.currentGame.title}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
