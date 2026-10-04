import type { GameShop, LudusaviBackup, LudusaviConfig } from "@types";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import cp from "node:child_process";
import { SystemPath } from "./system-path";
import { getSteamLocation } from "./steam";
import { getSteamLibraryFolders } from "./steam-library";
import { logger } from "./logger";

export class Ludusavi {
  private static ludusaviResourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "ludusavi")
    : path.join(__dirname, "..", "..", "ludusavi");

  private static configPath = path.join(
    SystemPath.getPath("userData"),
    "ludusavi"
  );
  private static binaryName =
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi";

  private static binaryPath = path.join(this.configPath, this.binaryName);

  public static async getConfig() {
    const config = YAML.parse(
      fs.readFileSync(path.join(this.configPath, "config.yaml"), "utf-8")
    ) as LudusaviConfig;

    return config;
  }

  public static async copyConfigFileToUserData() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });

      fs.cpSync(
        path.join(this.ludusaviResourcesPath, "config.yaml"),
        path.join(this.configPath, "config.yaml")
      );
    }
  }

  public static async copyBinaryToUserData() {
    if (!fs.existsSync(this.binaryPath)) {
      fs.cpSync(
        path.join(this.ludusaviResourcesPath, this.binaryName),
        this.binaryPath
      );
    }
  }

  /**
   * Registers the Steam installation and every Steam library folder as
   * Ludusavi roots so saves stored in Steam userdata, game install folders
   * and Proton prefixes can be found (e.g. for games imported from Steam).
   */
  public static async syncSteamRoots() {
    try {
      const steamLocation = await getSteamLocation().catch(() => null);
      if (!steamLocation || !fs.existsSync(steamLocation)) return;

      const steamPaths = [
        steamLocation,
        ...getSteamLibraryFolders(steamLocation),
      ];

      const config = await this.getConfig();
      const roots = config.roots ?? [];
      const knownPaths = new Set(roots.map((root) => path.resolve(root.path)));

      let changed = false;

      for (const steamPath of steamPaths) {
        const resolvedPath = path.resolve(steamPath);
        if (knownPaths.has(resolvedPath) || !fs.existsSync(steamPath)) continue;

        roots.push({ path: steamPath, store: "steam" });
        knownPaths.add(resolvedPath);
        changed = true;
      }

      if (!changed) return;

      config.roots = roots;

      fs.writeFileSync(
        path.join(this.configPath, "config.yaml"),
        YAML.stringify(config)
      );
    } catch (error) {
      logger.error("[Ludusavi] Failed to sync Steam roots", error);
    }
  }

  public static async backupGame(
    _shop: GameShop,
    objectId: string,
    backupPath?: string | null,
    winePrefix?: string | null,
    preview?: boolean
  ): Promise<LudusaviBackup> {
    await this.syncSteamRoots();

    return new Promise((resolve, reject) => {
      const args = [
        "--config",
        this.configPath,
        "backup",
        objectId,
        "--api",
        "--force",
      ];

      if (preview) args.push("--preview");
      if (backupPath) args.push("--path", backupPath);
      if (winePrefix) args.push("--wine-prefix", winePrefix);

      cp.execFile(
        this.binaryPath,
        args,
        (err: cp.ExecFileException | null, stdout: string) => {
          if (err) {
            return reject(err);
          }

          return resolve(JSON.parse(stdout) as LudusaviBackup);
        }
      );
    });
  }

  public static async getBackupPreview(
    _shop: GameShop,
    objectId: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup | null> {
    const config = await this.getConfig();

    const backupData = await this.backupGame(
      _shop,
      objectId,
      null,
      winePrefix,
      true
    );

    const customGame = config.customGames.find(
      (game) => game.name === objectId
    );

    return {
      ...backupData,
      customBackupPath: customGame?.files[0] || null,
    };
  }

  static async addCustomGame(title: string, savePath: string | null) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    if (savePath) {
      filteredGames.push({
        name: title,
        files: [savePath],
        registry: [],
      });
    }

    config.customGames = filteredGames;

    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
  }
}
