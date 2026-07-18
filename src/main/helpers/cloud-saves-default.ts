import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

/* Whether games newly added to the library should have automatic cloud sync
   already enabled ("Enable cloud saves by default" setting). */
export const getAutomaticCloudSyncDefault = async (): Promise<boolean> => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return userPreferences?.enableCloudSavesByDefault === true;
};
