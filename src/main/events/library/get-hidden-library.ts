import { registerEvent } from "../register-event";
import { collectLibraryGames } from "./get-library";

const getHiddenLibrary = () =>
  collectLibraryGames(
    (game) => game.isDeleted === false && game.isHidden === true
  );

registerEvent("getHiddenLibrary", getHiddenLibrary);
