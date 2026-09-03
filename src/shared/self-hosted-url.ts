/* Shape of the self-hosted cloud server URL, shared so the settings page that
   accepts one and the main process that points a client at it can never
   disagree about what counts as valid. */

/** Trims and drops trailing slashes; blank becomes `null` ("no server"). */
export const normalizeSelfHostedUrl = (url?: string | null) => {
  const trimmed = url?.trim();
  const normalized = trimmed?.replace(/\/+$/, "");
  return normalized ? normalized : null;
};

/** Whether a normalized URL is something a request can actually be sent to. */
export const isValidSelfHostedUrl = (url: string) => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};
