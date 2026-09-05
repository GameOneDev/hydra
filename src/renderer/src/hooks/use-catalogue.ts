import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import { logger } from "@renderer/logger";

const SUPPORTED_STEAM_METADATA_LANGUAGES = new Set([
  "en",
  "es",
  "pt",
  "ru",
  "fr",
]);

/* Filter metadata is optional — an unreachable catalogue host must not
   surface as unhandled rejections in the error overlay. */
const logCatalogueError = (resource: string) => (error: unknown) => {
  logger.error(`Failed to fetch catalogue resource ${resource}:`, error);
};

async function getLocalizedSteamMetadata<T>(endpoint: string, locale: string) {
  const language = locale.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language)
    ? language
    : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi.get<T>(endpoint, {
        params: { language: currentLanguage },
        needsAuth: false,
      });

      return [currentLanguage, data] as const;
    })
  );
  const metadata = Object.fromEntries(entries) as Record<string, T>;

  metadata[language] ??= metadata[requestLanguage];

  return metadata;
}

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamFilters = useCallback(async () => {
    try {
      const [tags, genres] = await Promise.all([
        getLocalizedSteamMetadata<Record<string, number>>(
          "/catalogue/steam/tags",
          i18n.language
        ),
        getLocalizedSteamMetadata<string[]>(
          "/catalogue/steam/genres",
          i18n.language
        ),
      ]);

      dispatch(setTags(tags));
      dispatch(setGenres(genres));
    } catch (error) {
      logCatalogueError("/catalogue/steam/tags,genres")(error);
    }
  }, [dispatch, i18n.language]);

  const getSteamPublishers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/publishers", { needsAuth: false })
      .then(setSteamPublishers)
      .catch(logCatalogueError("/catalogue/steam/publishers"));
  }, []);

  const getSteamDevelopers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/developers", { needsAuth: false })
      .then(setSteamDevelopers)
      .catch(logCatalogueError("/catalogue/steam/developers"));
  }, []);

  const getDownloadSources = useCallback(() => {
    levelDBService
      .values("downloadSources")
      .then((results) => {
        const sources = results as DownloadSource[];
        setDownloadSources(sources.filter((source) => !!source.fingerprint));
      })
      .catch((error) => {
        logger.error("Failed to read download sources from local db:", error);
      });
  }, []);

  useEffect(() => {
    getSteamFilters();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamFilters,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return { steamPublishers, downloadSources, steamDevelopers };
}
