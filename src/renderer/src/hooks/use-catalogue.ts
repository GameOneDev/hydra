import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import { logger } from "@renderer/logger";

export const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

/* Filter metadata is optional — a missing/unreachable external resources
   host must not surface as unhandled rejections in the error overlay. */
const logExternalResourceError = (resource: string) => (error: unknown) => {
  logger.error(`Failed to fetch external resource ${resource}:`, error);
};

export function useCatalogue() {
  const dispatch = useAppDispatch();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamUserTags = useCallback(() => {
    externalResourcesInstance
      .get("/steam-user-tags.json")
      .then((response) => {
        dispatch(setTags(response.data));
      })
      .catch(logExternalResourceError("/steam-user-tags.json"));
  }, [dispatch]);

  const getSteamGenres = useCallback(() => {
    externalResourcesInstance
      .get("/steam-genres.json")
      .then((response) => {
        dispatch(setGenres(response.data));
      })
      .catch(logExternalResourceError("/steam-genres.json"));
  }, [dispatch]);

  const getSteamPublishers = useCallback(() => {
    externalResourcesInstance
      .get("/steam-publishers.json")
      .then((response) => {
        setSteamPublishers(response.data);
      })
      .catch(logExternalResourceError("/steam-publishers.json"));
  }, []);

  const getSteamDevelopers = useCallback(() => {
    externalResourcesInstance
      .get("/steam-developers.json")
      .then((response) => {
        setSteamDevelopers(response.data);
      })
      .catch(logExternalResourceError("/steam-developers.json"));
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
    getSteamUserTags();
    getSteamGenres();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamUserTags,
    getSteamGenres,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return { steamPublishers, downloadSources, steamDevelopers };
}
