import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  CheckCircleFillIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useSelfHostedStatus, useToast } from "@renderer/hooks";
import type { SelfHostedServerProbe, SelfHostedServerStatus } from "@types";

import "./settings-self-hosted.scss";

const STATUS_ICON_SIZE = 14;

const isValidServerUrl = (value: string) => {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const normalizeServerUrl = (value: string) => value.trim().replace(/\/+$/, "");

/* The server answered, and answered with capabilities — anything less leaves
   the features routed to it disabled, so it is not a working connection. */
const isWorkingConnection = (probe: SelfHostedServerProbe) =>
  probe.reachable && probe.error === null;

/* Same three shades the status of a saved server uses, so a connection test
   and the live status read the same way. */
const resolveProbeState = (
  probe: SelfHostedServerProbe
): SelfHostedServerStatus["state"] => {
  if (isWorkingConnection(probe)) return "online";
  return probe.reachable ? "degraded" : "offline";
};

export function SettingsSelfHosted() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateUserPreferences } = useContext(settingsContext);
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  const { t } = useTranslation("settings");

  const { status, refresh, isRefreshing } = useSelfHostedStatus();

  const [cloudUrl, setCloudUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    url: string;
    probe: SelfHostedServerProbe;
  } | null>(null);

  const savedUrl = userPreferences?.selfHostedCloudUrl ?? "";

  useEffect(() => {
    setCloudUrl(savedUrl);
  }, [savedUrl]);

  const normalizedUrl = normalizeServerUrl(cloudUrl);
  const hasChanges = normalizedUrl !== savedUrl;

  const describeVersion = useCallback(
    (version: string | null) =>
      version
        ? t("self_hosted_server_version", { version })
        : t("self_hosted_version_unknown"),
    [t]
  );

  const describeProbe = useCallback(
    (probe: SelfHostedServerProbe) => {
      if (isWorkingConnection(probe)) {
        return [
          t("self_hosted_test_success", { latency: probe.latencyInMs ?? 0 }),
          describeVersion(probe.version),
          t("self_hosted_features_available", {
            count: probe.features.length,
          }),
        ].join(" · ");
      }

      if (probe.reachable) {
        return t("self_hosted_test_degraded", { error: probe.error });
      }

      return t("self_hosted_test_unreachable", { error: probe.error });
    },
    [describeVersion, t]
  );

  const describeStatus = useCallback(
    (value: SelfHostedServerStatus) => {
      if (value.state === "checking") return t("self_hosted_status_checking");

      if (value.state === "online") {
        return [
          t("self_hosted_status_online"),
          t("self_hosted_latency", { latency: value.latencyInMs ?? 0 }),
          describeVersion(value.version),
        ].join(" · ");
      }

      if (value.state === "degraded") {
        return t("self_hosted_status_degraded", { error: value.error });
      }

      if (value.state === "offline") {
        return t("self_hosted_status_offline", { error: value.error });
      }

      return t("self_hosted_status_disabled");
    },
    [describeVersion, t]
  );

  const runTest = useCallback(async (url: string) => {
    const probe = await window.electron.testSelfHostedServer(url);
    setTestResult({ url, probe });
    return probe;
  }, []);

  /**
   * One button for both jobs: a URL that isn't saved yet is probed on its own,
   * and the one already in use is re-probed through the main process, so the
   * launcher's own view of the server (and the status below) refreshes too.
   */
  const handleTest = async () => {
    if (!normalizedUrl || !isValidServerUrl(normalizedUrl)) {
      showErrorToast(t("self_hosted_invalid_url"));
      return;
    }

    if (normalizedUrl === savedUrl) {
      try {
        const next = await refresh();

        if (next.state === "online") {
          showSuccessToast(
            t("self_hosted_test_succeeded"),
            describeStatus(next)
          );
        } else {
          showWarningToast(t("self_hosted_test_failed"), describeStatus(next));
        }
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : String(err));
      }

      return;
    }

    setIsTesting(true);

    try {
      const probe = await runTest(normalizedUrl);

      if (isWorkingConnection(probe)) {
        showSuccessToast(t("self_hosted_test_succeeded"), describeProbe(probe));
      } else {
        showWarningToast(t("self_hosted_test_failed"), describeProbe(probe));
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isValidServerUrl(normalizedUrl)) {
      showErrorToast(t("self_hosted_invalid_url"));
      return;
    }

    setIsSubmitting(true);

    try {
      /* Ping before committing so a typo is reported here, instead of turning
         into features that silently stay off — reusing the result if the user
         just tested this very URL, rather than paying for it twice. */
      const probe = !normalizedUrl
        ? null
        : testResult?.url === normalizedUrl
          ? testResult.probe
          : await runTest(normalizedUrl).catch(() => null);

      await updateUserPreferences({
        selfHostedCloudUrl: normalizedUrl || null,
      });

      if (probe && !isWorkingConnection(probe)) {
        showWarningToast(
          t("self_hosted_saved_unreachable"),
          describeProbe(probe)
        );
      } else {
        showSuccessToast(
          t("self_hosted_saved"),
          t("self_hosted_saved_applied")
        );
      }
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusIcon = (state: SelfHostedServerStatus["state"]) => {
    if (state === "checking") {
      return <SyncIcon size={STATUS_ICON_SIZE} />;
    }

    if (state === "online") {
      return <CheckCircleFillIcon size={STATUS_ICON_SIZE} />;
    }

    return <AlertIcon size={STATUS_ICON_SIZE} />;
  };

  const isBusy = isSubmitting || isTesting || isRefreshing;

  return (
    <form className="settings-self-hosted" onSubmit={handleSubmit}>
      <p>{t("self_hosted_description")}</p>

      <TextField
        label={t("self_hosted_server_url")}
        value={cloudUrl}
        placeholder="https://hydra-cloud.example.com"
        onChange={(event) => {
          setCloudUrl(event.target.value);
          setTestResult(null);
        }}
        hint={t("self_hosted_server_url_hint")}
        rightContent={
          <div className="settings-self-hosted__actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleTest}
              disabled={isBusy || !normalizedUrl}
            >
              {isTesting || isRefreshing
                ? t("self_hosted_testing")
                : t("self_hosted_test_connection")}
            </Button>

            <Button type="submit" disabled={isBusy || !hasChanges}>
              {t("save_changes")}
            </Button>
          </div>
        }
      />

      {/* Only for a URL that isn't in use yet — once saved, the live status
          below says the same thing and keeps saying it. */}
      {testResult && testResult.url !== savedUrl && (
        <div
          className={`settings-self-hosted__status settings-self-hosted__status--${resolveProbeState(
            testResult.probe
          )}`}
        >
          {statusIcon(resolveProbeState(testResult.probe))}
          <small>{describeProbe(testResult.probe)}</small>
        </div>
      )}

      {savedUrl && (
        <div
          className={`settings-self-hosted__status settings-self-hosted__status--${status.state}`}
        >
          {statusIcon(status.state)}
          <small>{describeStatus(status)}</small>
        </div>
      )}

      <small className="settings-self-hosted__note">
        {t("self_hosted_apply_note")}
      </small>
    </form>
  );
}
