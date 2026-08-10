import type { GameShop } from "@types";

export interface GameContextMenuGame {
  id?: string;
  objectId: string;
  shop: GameShop;
  title: string;
  executablePath?: string | null;
  /** Steam-imported game launched through Steam rather than a local executable. */
  launchThroughSteam?: boolean;
  download?: { downloadPath?: string | null; status?: string | null } | null;
  favorite?: boolean;
  isPinned?: boolean;
  collectionIds?: string[];
  discs?: { path: string }[];
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  launchOptions?: string | null;
}
