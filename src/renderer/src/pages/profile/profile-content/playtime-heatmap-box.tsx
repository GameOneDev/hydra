import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import { useFormat, useLibrary } from "@renderer/hooks";
import { ProfileSection } from "../profile-section/profile-section";
import type { GameShop } from "@types";

import "./playtime-heatmap-box.scss";

interface PlaytimeGame {
  shop: GameShop;
  objectId: string;
  seconds: number;
}

interface PlaytimeDay {
  day: string;
  totalSeconds: number;
  games: PlaytimeGame[];
}

const WEEKS_TO_SHOW = 5;
const HEATMAP_LEVELS = 4;
const TOOLTIP_ID = "playtime-heatmap-tooltip";

const localDayKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

export function PlaytimeHeatmapBox() {
  const { t, i18n } = useTranslation("user_profile");
  const { library } = useLibrary();
  const { numberFormatter } = useFormat();

  const [days, setDays] = useState<PlaytimeDay[] | null>(null);

  useEffect(() => {
    /* Only the self-hosted cloud server implements this endpoint; when it's
       not configured the request fails and the section stays hidden. */
    window.electron.hydraApi
      .get<PlaytimeDay[]>("/profile/playtime", {
        params: { days: WEEKS_TO_SHOW * 7 },
      })
      .then((response) => setDays(Array.isArray(response) ? response : []))
      .catch(() => setDays(null));
  }, []);

  const titleByGame = useMemo(() => {
    const map = new Map<string, string>();
    library.forEach((game) => {
      if (game.title) map.set(`${game.shop}:${game.objectId}`, game.title);
    });
    return map;
  }, [library]);

  const dataByDay = useMemo(() => {
    const map = new Map<string, PlaytimeDay>();
    (days ?? []).forEach((entry) => map.set(entry.day, entry));
    return map;
  }, [days]);

  const weeks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - (WEEKS_TO_SHOW * 7 - 1));
    start.setDate(start.getDate() - start.getDay());

    const result: Date[][] = [];
    const cursor = new Date(start);

    while (cursor <= today) {
      const week: Date[] = [];
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        week.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      result.push(week);
    }

    return result;
  }, []);

  const maxSeconds = useMemo(
    () =>
      Math.max(
        0,
        ...Array.from(dataByDay.values(), (entry) => entry.totalSeconds)
      ),
    [dataByDay]
  );

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: "short",
        day: "numeric",
      }),
    [i18n.language]
  );

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: "short" }),
    [i18n.language]
  );

  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: "short" }),
    [i18n.language]
  );

  if (days === null) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const intensityLevel = (totalSeconds: number) => {
    if (totalSeconds <= 0 || maxSeconds <= 0) return 0;
    return Math.min(
      HEATMAP_LEVELS,
      Math.max(1, Math.ceil((totalSeconds / maxSeconds) * HEATMAP_LEVELS))
    );
  };

  const formatAmount = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));

    if (minutes < 60) return t("amount_minutes_short", { amount: minutes });

    return t("amount_hours_short", {
      amount: numberFormatter.format(Math.round((minutes / 60) * 10) / 10),
    });
  };

  const cellLabel = (date: Date, entry: PlaytimeDay | undefined) => {
    const formattedDate = dateFormatter.format(date);

    if (!entry || entry.totalSeconds <= 0) {
      return t("no_playtime_on_day", { date: formattedDate });
    }

    const amount = formatAmount(entry.totalSeconds);
    const topGame = entry.games[0];
    const topGameTitle = topGame
      ? titleByGame.get(`${topGame.shop}:${topGame.objectId}`)
      : undefined;

    if (topGameTitle) {
      return t("playtime_on_day_with_game", {
        amount,
        date: formattedDate,
        title: topGameTitle,
      });
    }

    return t("playtime_on_day", { amount, date: formattedDate });
  };

  const monthLabels = weeks.map((week, index) => {
    const month = week[0].getMonth();
    if (index > 0 && weeks[index - 1][0].getMonth() === month) return null;
    return monthFormatter.format(week[0]);
  });

  return (
    <ProfileSection title={t("playtime")} defaultOpen={true}>
      <div className="playtime-heatmap">
        <div className="playtime-heatmap__chart">
          <div className="playtime-heatmap__weekdays" aria-hidden="true">
            {weeks[0].map((date, row) => (
              <span
                key={date.toISOString()}
                className="playtime-heatmap__weekday"
              >
                {row % 2 === 1 ? weekdayFormatter.format(date) : ""}
              </span>
            ))}
          </div>

          <div className="playtime-heatmap__weeks">
            <div className="playtime-heatmap__months" aria-hidden="true">
              {monthLabels.map((label, index) => (
                <span
                  key={weeks[index][0].toISOString()}
                  className="playtime-heatmap__month"
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="playtime-heatmap__grid">
              {weeks.map((week) => (
                <div
                  key={week[0].toISOString()}
                  className="playtime-heatmap__week"
                >
                  {week.map((date) => {
                    if (date > today) {
                      return (
                        <span
                          key={date.toISOString()}
                          className="playtime-heatmap__cell playtime-heatmap__cell--future"
                        />
                      );
                    }

                    const entry = dataByDay.get(localDayKey(date));
                    const label = cellLabel(date, entry);

                    return (
                      <span
                        key={date.toISOString()}
                        role="img"
                        aria-label={label}
                        className={cn(
                          "playtime-heatmap__cell",
                          `playtime-heatmap__cell--level-${intensityLevel(entry?.totalSeconds ?? 0)}`
                        )}
                        data-tooltip-id={TOOLTIP_ID}
                        data-tooltip-content={label}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="playtime-heatmap__legend" aria-hidden="true">
          <span>{t("playtime_less")}</span>
          {Array.from({ length: HEATMAP_LEVELS + 1 }, (_, level) => (
            <span
              key={level}
              className={cn(
                "playtime-heatmap__cell",
                `playtime-heatmap__cell--level-${level}`
              )}
            />
          ))}
          <span>{t("playtime_more")}</span>
        </div>

        <Tooltip id={TOOLTIP_ID} style={{ zIndex: 10 }} />
      </div>
    </ProfileSection>
  );
}
