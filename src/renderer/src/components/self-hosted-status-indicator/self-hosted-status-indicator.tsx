import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useSelfHostedStatus } from "@renderer/hooks";

import "./self-hosted-status-indicator.scss";

export interface SelfHostedStatusIndicatorProps {
  /** Online shows only the latency ("23 ms"); the full label moves to the
      tooltip. For the title bar, where room is shared with the search. */
  compact?: boolean;
}

/**
 * Self-hosted cloud storage server health. Renders nothing when no server is
 * configured — the official Hydra Cloud has no status the user needs to
 * babysit.
 */
export function SelfHostedStatusIndicator({
  compact = false,
}: Readonly<SelfHostedStatusIndicatorProps>) {
  const { t } = useTranslation("bottom_panel");

  const { status, refresh, isRefreshing } = useSelfHostedStatus();

  const handleClick = useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]);

  if (status.state === "disabled" || !status.url) return null;

  const isChecking = isRefreshing || status.state === "checking";

  const label = () => {
    if (isChecking) return t("self_hosted_checking");

    if (status.state === "online") {
      const latency = status.latencyInMs ?? 0;

      return status.version
        ? t("self_hosted_online_version", {
            latency,
            version: status.version,
          })
        : t("self_hosted_online", { latency });
    }

    if (status.state === "degraded") return t("self_hosted_degraded");

    return t("self_hosted_offline");
  };

  /* Problems keep their words even when compact: a dot alone is easy to miss
     when the server goes down. Checking is just the pulsing dot. */
  const visibleLabel = () => {
    if (!compact) return label();
    if (isChecking) return null;
    if (status.state === "online") {
      return t("self_hosted_online_compact", {
        latency: status.latencyInMs ?? 0,
      });
    }
    return label();
  };

  const visible = visibleLabel();

  const tooltip = [
    compact ? label() : "",
    t("self_hosted_tooltip", { url: status.url }),
    status.error ? t("self_hosted_tooltip_error", { error: status.error }) : "",
    t("self_hosted_tooltip_hint"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <button
      type="button"
      title={tooltip}
      onClick={handleClick}
      disabled={isChecking}
      className={`self-hosted-status-indicator self-hosted-status-indicator--${
        isChecking ? "checking" : status.state
      }`}
    >
      <span className="self-hosted-status-indicator__dot" />
      {visible && <small>{visible}</small>}
    </button>
  );
}
