<p align="center">
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">
    <img src="docs/assets/brand/logo-eyes.webp" width="120" height="120" alt="AnyModelBot Eyes mark: two vertical pill-shaped eyes that glance left and right">
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.svg">
    <img src="docs/assets/brand/wordmark-light.svg" height="40" alt="AnyModelBot">
  </picture>
</h1>

<p align="center"><b>Your own AI bot, on your own computer. Any model, pay per use.</b></p>

<p align="center">
  <a href="https://anymodel.bot/">Website</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">Download</a> |
  <a href="./README.md">简体中文</a> |
  English |
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">Modelflare</a> |
  <a href="https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme">Pricing</a> |
  <a href="./docs/development_en.md">Development</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/issues">Feedback</a>
</p>

<div align="center">

[![Release][release-shield]][releases-link]
[![Downloads][downloads-shield]][releases-link]
[![Stars][stars-shield]][stars-link]
[![License][license-shield]][license-link]
[![CI][ci-shield]][ci-link]

[![Platform][platform-shield]][releases-link]
[![Pricing][pricing-shield]][pricing-link]
[![Modelflare][modelflare-shield]][modelflare-link]
[![X][x-shield]][x-link]

</div>

<p align="center">
  <img src="docs/assets/hero/hero-demo.gif" alt="AnyModelBot in action: sign in to Modelflare, pick a model, ask a bot to tidy a folder, and approve a file move" width="100%">
</p>

# 🤖 AnyModelBot

AnyModelBot is a local-first AI agent app for Windows, macOS and Linux. A bot is a persona with its own default model, workspace and memory. Chat with it in the app, or reach it from WeChat and Feishu. Let it read and write files, run commands and operate your desktop, with an approval prompt whenever it steps outside its workspace.

Your conversations, memory, files and API keys live on your device. Models come from [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): one account, any model, priced per token. AnyModelBot itself has no subscription.

📥 [Download](#-download) · 🌠 [Screenshots](#-screenshots) · 🌟 [Features](#-key-features) · 🔐 [Privacy](#-how-it-works--privacy)

⭐ Like AnyModelBot? Star the repo to follow new releases.

---

<table>
<tr>
<td width="200" align="center" valign="middle">
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">
    <img src="docs/assets/modelflare/modelflare-logo.png" width="120" height="120" alt="Modelflare logo">
  </a>
</td>
<td>

**[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)** is an OpenAI-compatible AI API gateway with 200,000+ registered developers. One API key opens 70+ text, image and video models from 13 providers, including GPT, Claude, Gemini, Grok, DeepSeek, Kimi and GLM. Requests are routed across providers with ordered fallback, and every request is recorded with its usage and cost. Prices are public and billed per token.

**[Sign up for Modelflare →](https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme)** ·
[Price list](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[API docs](https://docs.modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[Trust Center](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[X](https://x.com/modelflare_dev)

</td>
</tr>
</table>

**How AnyModelBot uses Modelflare**

- **Sign in once.** The first launch opens your browser to sign in to (or sign up for) Modelflare. The app then connects this device itself, so there is no key to copy. Running in Docker or on a server? Paste an API key instead.
- **Every model, one picker.** Your Modelflare models are listed automatically, with context length, capabilities and reference prices next to each one.
- **Pay for what you use.** Balance, low-balance reminders and per-day usage show up inside the app. Check the public price list and compare it with the official rates before you choose a model.
- **An honest boundary.** Model requests travel through Modelflare to the provider you pick, and Modelflare keeps request logs. See the [Trust Center](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) for what is kept and for how long. Everything else stays on your device ([details](#-how-it-works--privacy)).

---

# 📥 Download

Pick your platform. Every release page lists all installers and a `SHA256SUMS` file.

| Platform | Architecture | Installer | |
| :--- | :--- | :--- | :--- |
| ![Windows][win-badge] | x64 | `anymodel-bot-<version>-win-x64.exe` | [Download][releases-link] |
| ![Windows][win-badge] | arm64 | `anymodel-bot-<version>-win-arm64.exe` | [Download][releases-link] |
| ![macOS][mac-badge] | Apple silicon | `anymodel-bot-<version>-mac-arm64.dmg` | [Download][releases-link] |
| ![macOS][mac-badge] | Intel | `anymodel-bot-<version>-mac-x64.dmg` | [Download][releases-link] |
| ![Linux][linux-badge] | x64 | `anymodel-bot-<version>-linux-x86_64.AppImage` | [Download][releases-link] |
| ![Linux][linux-badge] | arm64 | `anymodel-bot-<version>-linux-arm64.AppImage` | [Download][releases-link] |

<p align="center">
  <img src="docs/assets/download/install-windows.gif" alt="Installing AnyModelBot on Windows: run the installer, open the app, and land on the Modelflare sign-in screen" width="100%">
</p>

**First launch.** If your system warns about an app downloaded from the internet, choose *More info → Run anyway* on Windows, or *System Settings → Privacy & Security → Open Anyway* on macOS. On Linux, mark the AppImage as executable (`chmod +x`) and run it. Closing the window hides AnyModelBot to the tray; quit from the tray menu or from Settings.

**Verify a download.**

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS use `shasum -a 256 <file>`; in Windows PowerShell use `Get-FileHash <file>`. Compare the result with the line in `SHA256SUMS`.

**Run from source or in Docker**

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup      # fetches and builds the bundled gateway
npm start          # opens the local console at http://127.0.0.1:3600/
```

```bash
git submodule update --init --depth 1 vendor/magpie   # the image builds the gateway from source
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token   # then open http://<host>:3600/?token=<token>
```

Requirements for building from source: Node.js 22.13+ and Go 1.26.8+. More in the [development guide](./docs/development_en.md).

# 🌠 Screenshots

The app UI is currently in Simplified Chinese.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.webp">
  <img src="docs/assets/screenshots/chat-light.webp" alt="Chat screen: a reply with a Markdown list and a code block, the model button in the composer, and the bot list on the left" width="100%">
</picture>

<p align="center"><i>Chat with a bot. Replies render Markdown and code, and the composer shows which model it is using.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/agent-dark.webp">
  <img src="docs/assets/screenshots/agent-light.webp" alt="Agent screen: a step-by-step activity list for a file task and an approval card asking to write outside the workspace" width="100%">
</picture>

<p align="center"><i>Agent work is visible step by step. Anything outside the workspace waits for your approval.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/models-dark.webp">
  <img src="docs/assets/screenshots/models-light.webp" alt="Model picker: searchable list of Modelflare models with context length, capability tags and reference prices" width="100%">
</picture>

<p align="center"><i>Pick any Modelflare model per conversation. Context length, capabilities and reference prices sit next to each one.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/memory-dark.webp">
  <img src="docs/assets/screenshots/memory-light.webp" alt="Info panel showing a bot's memory entries, connected channels and recent sessions" width="100%">
</picture>

<p align="center"><i>Memory, channels and sessions for each bot, in one panel.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/modelflare-dark.webp">
  <img src="docs/assets/screenshots/modelflare-light.webp" alt="Settings, Modelflare tab with the usage dialog open: daily usage for the last 7 days, the default model row below, and the balance on the account button" width="100%">
</picture>

<p align="center"><i>Your Modelflare account inside the app: balance, usage and defaults.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/bots-dark.webp">
  <img src="docs/assets/screenshots/bots-light.webp" alt="Six AnyModelBot characters in a row, each with its own color" width="100%">
</picture>

<p align="center"><i>Six characters to tell your bots apart. Their eyes follow your pointer.</i></p>

# 🌟 Key Features

## 🤖 Bots that do the work

A bot is more than a chat window: it has a persona, a default model, its own workspace and its own memory.

- **Make as many bots as you need**, each with its own persona, model, workspace and avatar.
- **Real file work.** Bots read and write files, run commands in a sandbox, and send the results back to the chat as files.
- **Three permission presets per bot.** *Read-only*, *Workspace* (the default: write inside the bot's own folder, ask before anything outside) and *Full access* (no sandbox; recursive deletes still ask first).
- **Approval cards, not surprises.** Out-of-bounds actions stop and wait for your answer.
- **Told after a restart.** A message still in progress when the app quit or crashed is flagged in its conversation at the next start, so you can send it again; nothing is redone on its own.
- **Slash commands** such as `/model` and `/reset` work in the app and in WeChat and Feishu chats.

<p align="center">
  <img src="docs/assets/features/agent-files.gif" alt="A bot tidies a messy folder: it lists the files, proposes a plan, and an approval card asks before moving files outside its workspace" width="100%">
</p>

## 🖥️ Operates your computer, and makes images and video

- **Computer use** is powered by the bundled [Cua Driver](https://github.com/trycua/cua). By default, actions run automatically. Switch a bot to *ask before changing the screen* and every click and keystroke waits for you. Reading the screen never needs approval. On macOS, computer use is a Beta feature.
- **Image and video generation** runs right away with the default model at a normal cost. It asks first when switching models, when the estimated cost is high or when the request is unclear, so you see the model and prompt and can swap the model on the spot. To be asked every time, turn it on in the bot's settings.

<p align="center">
  <img src="docs/assets/features/computer-use.gif" alt="A bot opens Notepad, types a short note and saves it, while an approval card asks before each click and keystroke" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/media-generation.gif" alt="A bot asks which model to use for an image, the user confirms, and the finished image arrives in the chat as a file and opens in a viewer" width="100%">
</p>

## 🌐 Any model, through Modelflare

- **Sign in once** and your Modelflare models appear automatically. Prefer a key? Paste one.
- **One picker for everything.** GPT, Claude, Gemini, Grok, DeepSeek, Kimi, GLM and more, each with context length, capability tags and a reference price.
- **Switch per conversation** or set a default per bot. Background chores such as tidying memory and context hand-offs can use a separate model of their own.
- **Two routes.** Choose the international route or the one optimized for mainland China; AnyModelBot never switches between them on its own.
- **Pay per use.** Wallet balance, low-balance reminders, daily usage and per-bot budget keys are built in. AnyModelBot has no subscription.

<p align="center">
  <img src="docs/assets/features/first-run.gif" alt="First launch: click Sign in to Modelflare, approve in the browser, return to the app with models listed, and send a first message" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/model-switch.gif" alt="Opening the model picker, searching for a model, reading its context length and reference price, and switching the conversation to it" width="100%">
</p>

## 🧠 Memory, and reachable from anywhere

- **Memory that carries over.** Bots keep Markdown memory at three levels (team, bot and group) and filter out anything that looks like a secret.
- **Long chats stay usable.** A context steward compacts or starts a fresh segment with a hand-off summary before the window fills up.
- **WeChat and Feishu.** Scan a QR code to connect WeChat, or connect a Feishu bot with streaming reply cards. WeChat also carries images and files.
- **Four ways to run it.** Desktop app, command line, Docker, or the local web console at `127.0.0.1:3600`.

<p align="center">
  <img src="docs/assets/features/memory.gif" alt="Telling a bot to remember a preference, opening the info panel to see the new memory entry, then starting a new chat where the bot uses it" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/channels-wechat.gif" alt="Scanning a QR code to connect WeChat, sending a question from the phone, and the bot answering on the phone while the conversation shows up under Recent sessions in the desktop app" width="100%">
</p>

## 🔒 Local-first, and easy on the eyes

- **Your data stays with you.** Conversations, memory, files and API keys are stored on your device. The local console listens on `127.0.0.1` only, and the desktop app generates a fresh access token on every launch.
- **It answers to you.** By default a bot replies only to its owner (the WeChat account that scanned the QR code; on Feishu, the first person to message it after you connect it, which is you) and the people you allow. Anyone else gets a one-line notice and no model is called; you let them in from the info panel, or by replying `yes <code>` in chat.
- **Replies are not lost.** A reply is saved locally before it is sent; network errors are retried, sending resumes after a restart, and when WeChat's 24-hour window has closed the reply waits and arrives with your next message.
- **Telemetry kept off.** Telemetry in the bundled computer-use driver is switched off, and the built-in gateway runs with auto-update disabled.
- **Light, dark or follow the system.** Six bot characters, and their eyes follow your pointer.
- **Tray and autostart.** Close the window to hide to the tray; autostart is available on macOS and Windows.

<p align="center">
  <img src="docs/assets/features/characters-eyes.gif" alt="Six AnyModelBot characters in a row; their eyes follow the pointer as it moves across them" width="100%">
</p>

> [!NOTE]
> Features depend on the model you choose, your operating system and the permissions you grant. Computer use requires a desktop session, and macOS computer use is in Beta. Model requests go through Modelflare to the provider you pick; see [How it works & privacy](#-how-it-works--privacy).

# 🔐 How it works & privacy

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/data-flow-dark.svg">
  <img src="docs/assets/diagrams/data-flow-light.svg" alt="Data flow: conversations, memory, files and keys stay on your device; model requests go through Modelflare to the model provider; WeChat and Feishu messages pass through those platforms" width="100%">
</picture>

| Stays on your device | Leaves your device |
| :--- | :--- |
| Conversations and sessions (local SQLite database) | The prompts, files and tool results a model needs to answer, sent through Modelflare to the provider you chose |
| Memory (Markdown files) | Screenshots, when you ask a bot to look at your screen with computer use |
| Files in each bot's workspace | Messages you exchange over WeChat or Feishu, which pass through those platforms |
| Your API key and sign-in tokens | Your sign-in with Modelflare, which happens at modelflare.dev |
| Settings | |

Modelflare keeps request logs; its [Trust Center](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) explains what is kept and for how long. We do not claim your data is beyond all risk: anything you send to a model leaves your device. The full inventory is in [docs/privacy_en.md](./docs/privacy_en.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="Architecture: Electron shell, command line or Docker start a Node.js and TypeScript backend with a Preact UI, SQLite, the DSH agent runtime and channel adapters, which call the bundled magpie gateway, which calls Modelflare" width="100%">
</picture>

| Layer | Technology |
| :--- | :--- |
| Interface | Preact + htm, no build step |
| Backend | Node.js 22.13+, TypeScript, `node:sqlite` |
| Desktop shell | Electron, with a tray |
| Model gateway | [magpie](https://github.com/yetone/magpie) (Go, MIT), bundled and started by the app |
| Agent runtime | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), run as a separate process |
| Computer use | [Cua Driver](https://github.com/trycua/cua), bundled |
| Channels | Feishu (long connection + streaming cards), WeChat (iLink) |
| Tests and CI | Vitest, GitHub Actions |

# 📝 Roadmap

Directions we are exploring. They are not promises, and the order is not a schedule.

- [ ] **Scheduled tasks**: let a bot run work on a timer.
- [ ] **Group chats**: Feishu bots handle one-to-one chats today.
- [ ] **English interface**: the app UI is Simplified Chinese today.
- [ ] **macOS computer use**: verify direct mode on more real machines and move it out of Beta.
- [ ] **A standalone mobile app**: today you reach your bots from WeChat or Feishu.

Have a different idea? Open an [issue](https://github.com/modelflare-ai/AnyModelBot/issues) or start a [discussion](https://github.com/modelflare-ai/AnyModelBot/discussions). Items we pick up are tracked with the [`roadmap`](https://github.com/modelflare-ai/AnyModelBot/labels/roadmap) label.

# 🤝 Contributing

Bug reports, fixes, docs and ideas are all welcome.

1. Check existing [issues](https://github.com/modelflare-ai/AnyModelBot/issues) and [discussions](https://github.com/modelflare-ai/AnyModelBot/discussions) first. Issues labeled [`good first issue`](https://github.com/modelflare-ai/AnyModelBot/labels/good%20first%20issue) are a good place to start.
2. Fork the repo and create a branch from `master`.
3. Run it locally and make your change:

   ```bash
   npm install
   npm run setup          # fetches and builds the bundled gateway
   npm run electron:dev   # desktop app in development mode
   npm run typecheck && npm test
   ```

4. Open a pull request against `master` and describe what changed and why. For anything larger than a small fix, open an issue first so we can agree on the approach.

Read the full [contributing guide](./CONTRIBUTING_en.md). To report a security problem, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

# 🔗 Related Projects

- [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): the AI API gateway behind AnyModelBot's models.
- [magpie](https://github.com/yetone/magpie): the Go gateway bundled with the app (MIT).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): the agent runtime (MIT).
- [Cua](https://github.com/trycua/cua): the computer-use driver.
- [kimi-computer-use](https://github.com/songkeys/kimi-computer-use): the macOS computer-use bridge.
- [openclaw-weixin](https://github.com/Tencent/openclaw-weixin): the WeChat channel we ported from (MIT).
- [DS Bot](https://github.com/Fei2411/DS-Bot): the design source for our memory and context steward (Apache-2.0).

Full licenses and notices: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

# 💬 Community

- **Questions and ideas:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bugs and feature requests:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)
- **Email:** [support@anymodel.bot](mailto:support@anymodel.bot)
- **News from Modelflare:** [@modelflare_dev on X](https://x.com/modelflare_dev)

# 🚀 Contributors

<a href="https://github.com/modelflare-ai/AnyModelBot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=modelflare-ai/AnyModelBot" alt="Contributors to AnyModelBot" />
</a>

# ⭐️ Star History

<a href="https://www.star-history.com/#modelflare-ai/AnyModelBot&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" />
    <img alt="Star history chart for AnyModelBot" src="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" width="100%" />
  </picture>
</a>

# 📜 License

AnyModelBot is released under the [MIT License](./LICENSE). Bundled third-party software keeps its own licenses; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) and the [`LICENSES/`](./LICENSES) folder.

<!-- link & badge references -->
[release-shield]: https://img.shields.io/github/v/release/modelflare-ai/AnyModelBot?include_prereleases&label=release&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iOTQiIGhlaWdodD0iODIiIHJ4PSIzNiIgZmlsbD0iI2Q3ZmYwMCIvPjxyZWN0IHg9IjI5IiB5PSIzNiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjI4IiByeD0iNi41IiBmaWxsPSIjMTYxYTAwIi8+PHJlY3QgeD0iNTgiIHk9IjM2IiB3aWR0aD0iMTMiIGhlaWdodD0iMjgiIHJ4PSI2LjUiIGZpbGw9IiMxNjFhMDAiLz48L3N2Zz4=&style=flat-square&labelColor=161a00&color=d7ff00
[downloads-shield]: https://img.shields.io/github/downloads/modelflare-ai/AnyModelBot/total?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[stars-shield]: https://img.shields.io/github/stars/modelflare-ai/AnyModelBot?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[license-shield]: https://img.shields.io/github/license/modelflare-ai/AnyModelBot?logo=opensourceinitiative&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[ci-shield]: https://img.shields.io/github/actions/workflow/status/modelflare-ai/AnyModelBot/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[platform-shield]: https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-d7ff00?style=flat-square&labelColor=161a00
[pricing-shield]: https://img.shields.io/badge/pricing-pay--as--you--go-d7ff00?style=flat-square&labelColor=161a00
[modelflare-shield]: https://img.shields.io/badge/Modelflare-modelflare.dev-d7ff00?style=flat-square&labelColor=161a00
[x-shield]: https://img.shields.io/badge/X-@modelflare__dev-d7ff00?style=flat-square&labelColor=161a00&logo=x&logoColor=d7ff00
[win-badge]: https://img.shields.io/badge/Windows-161a00?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Q3ZmYwMCI+PHJlY3QgeD0iMiIgeT0iMyIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48cmVjdCB4PSIxMi41IiB5PSIzIiB3aWR0aD0iOS41IiBoZWlnaHQ9IjguNSIvPjxyZWN0IHg9IjIiIHk9IjEyLjUiIHdpZHRoPSI5LjUiIGhlaWdodD0iOC41Ii8+PHJlY3QgeD0iMTIuNSIgeT0iMTIuNSIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48L3N2Zz4=
[mac-badge]: https://img.shields.io/badge/macOS-161a00?style=for-the-badge&logo=apple&logoColor=d7ff00
[linux-badge]: https://img.shields.io/badge/Linux-161a00?style=for-the-badge&logo=linux&logoColor=d7ff00

[releases-link]: https://github.com/modelflare-ai/AnyModelBot/releases
[stars-link]: https://github.com/modelflare-ai/AnyModelBot/stargazers
[license-link]: https://github.com/modelflare-ai/AnyModelBot/blob/master/LICENSE
[ci-link]: https://github.com/modelflare-ai/AnyModelBot/actions/workflows/ci.yml
[pricing-link]: https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme
[modelflare-link]: https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme
[x-link]: https://x.com/modelflare_dev
