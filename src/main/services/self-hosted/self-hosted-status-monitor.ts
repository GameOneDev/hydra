import { HydraApi } from "../hydra-api";
import { networkLogger as logger } from "../logger";

/**
 * Keeps the self-hosted server status the launcher displays fresh.
 *
 * One unauthenticated probe per interval — `/health` and `/capabilities`, read
 * in parallel — and only while a server is actually configured: with none, the
 * tick is a no-op and nothing leaves the machine.
 */
export class SelfHostedStatusMonitor {
  public static readonly REFRESH_INTERVAL_IN_MS = 600_000;

  private static interval: NodeJS.Timeout | null = null;

  public static start() {
    if (this.interval) return;

    this.interval = setInterval(() => {
      void this.tick();
    }, this.REFRESH_INTERVAL_IN_MS);

    /* Node keeps the process alive for pending timers; this one should never
       be the reason the app lingers on quit. */
    this.interval.unref?.();
  }

  public static stop() {
    if (!this.interval) return;

    clearInterval(this.interval);
    this.interval = null;
  }

  private static async tick() {
    if (!HydraApi.isSelfHostedCloudEnabled()) return;

    await HydraApi.refreshSelfHostedStatus().catch((err) => {
      logger.error("failed to refresh self-hosted server status", err);
    });
  }
}
