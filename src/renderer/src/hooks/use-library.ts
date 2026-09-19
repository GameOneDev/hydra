import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setHiddenLibrary, setLibrary } from "@renderer/features";

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);
  const hiddenLibrary = useAppSelector((state) => state.library.hidden);

  const updateLibrary = useCallback(async () => {
    const [updatedLibrary, updatedHiddenLibrary] = await Promise.all([
      window.electron.getLibrary(),
      window.electron.getHiddenLibrary(),
    ]);

    dispatch(setLibrary(updatedLibrary));
    dispatch(setHiddenLibrary(updatedHiddenLibrary));
  }, [dispatch]);

  return { library, hiddenLibrary, updateLibrary };
}
