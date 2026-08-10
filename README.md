<div align="center">

[<img src="https://raw.githubusercontent.com/hydralauncher/hydra/refs/heads/main/resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>An open-source gaming platform to manage your whole game library</strong>
  </p>

[![build](https://img.shields.io/github/actions/workflow/status/GameOneDev/hydra/build.yml)](https://github.com/GameOneDev/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/GameOneDev/hydra)](https://github.com/GameOneDev/hydra/releases)

![Hydra Launcher Home Page](./docs/screenshot.png)

</div>

## About this fork

This is a fork of [hydralauncher/hydra](https://github.com/hydralauncher/hydra) that adds a **self-hosted cloud backend**. In upstream Hydra, features like cloud saves, achievement sync and custom game artwork are gated behind a paid Hydra Cloud subscription. This fork lets you point the launcher at your own server — [**GameOneDev/hydra-server**](https://github.com/GameOneDev/hydra-server).

You keep using your normal Hydra account. Login, friends, the catalogue and everything else still go through the official servers — only the cloud-storage features are redirected to your own server when you configure one. Leave the server field empty and the launcher behaves exactly like upstream (using the official Hydra Cloud subscription).

## What this fork adds

- **🖥️ Self-hosted cloud storage** — point Hydra at your own [`hydra-server`](https://github.com/GameOneDev/hydra-server) instance from **Settings → Integrations → Self-hosted cloud storage**.
- **☁️ Self-hosted cloud saves** — back up and restore game saves to your own server instead of Hydra Cloud.
- **🏆 Self-hosted achievement sync** — unlock and sync achievements without a subscription. Achievement names are matched case-insensitively and kept even for games that are no longer in your library.
- **🖼️ Custom game images** — read and share your own covers, icons, logos and banners from your server, just like Hydra Cloud does for subscribers. Custom images are visible to anyone who views your profile.
- **🔄 Download-source sync** — keep your download sources synced through your own server.

## Connecting to your self-hosted server

1. Deploy [**GameOneDev/hydra-server**](https://github.com/GameOneDev/hydra-server) and note its URL (e.g. `https://hydra-cloud.example.com`).
2. In the launcher, open **Settings → Integrations → Self-hosted cloud storage**.
3. Paste your server URL (`http://` or `https://`) and save.
4. That's it — cloud saves, achievements, custom artwork and download-source sync now route to your server. Clear the field at any time to switch back to the official Hydra Cloud subscription.

## Features (from upstream Hydra)

- Add games that you own to your library
- Have a nice profile that shows what you are playing to your friends
- Save your game progress in the cloud
- Unlock achievements
- Navigate through a rich catalogue with a powerful suggestion algorithm
- Discover new games that you haven't played before

## Build from source and contributing

Hydra is written in Node.js (Electron, React, TypeScript), Python, and Rust. For general architecture and setup, refer to the upstream documentation: [docs.hydralauncher.gg](https://docs.hydralauncher.gg/getting-started).

### Local development requirements

- Node.js + Yarn
- Python 3.9+ with `pip install -r requirements.txt`
- Rust toolchain (for `hydra-native`)

Install dependencies with `yarn`. After install, `postinstall` builds the Rust native addon automatically (`hydra-native/hydra-native.node`).

Packaging scripts (`yarn build:win`, `yarn build:mac`, `yarn build:linux`, `yarn build:unpack`) run `yarn build:python-rpc` automatically.

### Environment variables

Copy `.env.example` to `.env` and fill in the values you need. The self-hosted server URL is configured at runtime in the app's settings, not through environment variables.

## Related projects

- [**GameOneDev/hydra-server**](https://github.com/GameOneDev/hydra-server) — the self-hosted backend this fork talks to.
- [**hydralauncher/hydra**](https://github.com/hydralauncher/hydra) — the upstream launcher.

## Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra is licensed under the [MIT License](LICENSE).
