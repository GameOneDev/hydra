import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";

/**
 * The fork's one-click Steam import, with the other library actions. It lived
 * in the page header until upstream removed that header in 4.4.1; keeping it
 * in its own file leaves `library.tsx` a two-line patch point.
 */
export function LibrarySteamImportButton() {
  const { t } = useTranslation("header");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showWarningToast, showErrorToast } = useToast();
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    if (isImporting) return;

    setIsImporting(true);

    try {
      const result = await window.electron.importSteamGames();

      updateLibrary();

      if (result.importedGames.length > 0) {
        showSuccessToast(
          t("import_steam_games_success", {
            count: result.importedGames.length,
          })
        );
      } else if (result.totalInstalled > 0) {
        showSuccessToast(t("import_steam_games_up_to_date"));
      } else {
        showWarningToast(t("import_steam_games_none_found"));
      }
    } catch {
      showErrorToast(t("import_steam_games_error"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Button
      theme="outline"
      className={`library__action library__action--icon${isImporting ? " library__action--scanning" : ""}`}
      onClick={handleImport}
      disabled={isImporting}
      aria-label={t("import_steam_games_tooltip")}
      tooltip={t("import_steam_games_tooltip")}
      tooltipPlace="bottom"
      tooltipInPortal
    >
      {isImporting ? (
        <SyncIcon size={16} />
      ) : (
        <SteamLogo width={16} height={16} />
      )}
    </Button>
  );
}
