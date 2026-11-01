# Development guide

[简体中文](./development.md) | English

This guide is for people who want to run AnyModelBot from source, package it, or contribute. If you only want to use the app, download an installer from [Releases](https://github.com/modelflare-ai/AnyModelBot/releases); see the [README](../README_en.md#-download).

- A bot = persona + default model + channels (Feishu / WeChat). Scope: personal, single user; each bot maps to one Feishu app.
- Models come from [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): on first launch you sign in to (or sign up for) a Modelflare account and the models are listed automatically; you can also paste an API key. Requests go through the bundled [magpie](https://github.com/yetone/magpie) gateway.
- Three ways to run, one codebase: **desktop app (Electron)**, **command line `npm start`**, **Docker**.

## Repository layout

```
src/
  core/          shared message types, session queue and dedup, runtime (/model /reset, streaming), the notice after a restart, admission (owner + allowlist), durable outbox
  agent/         agent mode: DSH host and bridge, approvals, permission presets, memory and context steward, image / video generation, web search, computer use, Windows PowerShell
    prompts/     every prompt the agent model reads: persona, chat rules, memory guide, a segment's first message, skills
  llm/           OpenAI-compatible client (model access interface)
  magpie/        magpie supervisor: isolated directories, free port, generated secret, health checks, crash restart, clean exit
  channels/      feishu/ (long connection + CardKit)  weixin/ (iLink; MIT notice in LICENSE.openclaw-weixin)  messenger/ (Telegram, Slack, Discord, sharing one send and receive path)
  store/         SQLite (node:sqlite, no native build)
  account/       Modelflare account: PKCE loopback sign-in, token rotation, balance and reminders, per-bot budget keys, model capabilities and reference prices
  web/           console server (JSON API + streaming chat over SSE)
  cli/           init first-run wizard, weixin-login
  modelflare.ts  Modelflare routes, key validation (GET /v1/models), model routing and attribution
  guide.ts       onboarding checklist progress
  i18n/          server-side i18n: errors, status text, tray menu, system messages from bots (messages/<namespace>.ts)
  diagnostics.ts troubleshooting: probes, log tail, redacted diagnostics report
  main.ts        command-line entry point
electron/        desktop main process (launcher + tray)
ui/              console UI (Preact + htm, no build step)
  design/        design system: tokens/, base/, components/, bot characters bots/
  locales/       UI strings: zh-CN/ and en/, one file per namespace
  css/ lib/ components/ screens/ assets/ main.js
dsh-runtime/     dependency manifest for the DSH agent runtime and AnyModelBot plugins (plugins/)
scripts/         setup / build-magpie / fetch-cua-driver / prepare-dsh / bundle-dsh / electron-smoke / check-readme and more
vendor/          git submodules: magpie (compiled at build time), deepseek-harness, kimi-computer-use
site/            website (Astro static site); see site/README.md
docs/            development guide, privacy notes, README assets (docs/assets/)
```

## Run from source (command line)

Requires Node.js 22.13+ and Go 1.26.8+ (to compile magpie from source).

```bash
npm install
npm run setup        # fetch the vendor/magpie submodule and compile it into build/bin/
npm run init         # optional: first-run setup in the terminal (sign in to Modelflare or paste an API key, Feishu credentials)
npm start            # start everything: gateway + bots + console at http://127.0.0.1:3600/
```

Data lives in `./data` by default (change it with `AMB_DATA_DIR`). Other environment variables are listed in `.env.example`.

## Desktop app (Electron)

```bash
npm run electron:dev     # run in development mode
npm run electron:smoke   # smoke test (uses xvfb-run automatically on headless Linux)
npm run dist             # package for the current platform (magpie ships in resources/magpie/)
npm run dist:linux | dist:mac | dist:win
npm run test:dsh-bundle  # real DSH integration test under Electron against the packed build/dsh (run prepare:dsh + bundle:dsh first)
```

- DSH agent runtime: `scripts/prepare-dsh.mjs` installs `dsh-runtime/` for the target platform, and `scripts/bundle-dsh.mjs` packs it into `resources/dsh/dsh.asar` (all JavaScript, one file) plus `resources/dsh/node_modules/` (native packages only, about 55 files). The Electron main process and `ELECTRON_RUN_AS_NODE` child processes read the asar directly, with no extraction on first launch, so the installer only unpacks a few hundred files (on Windows, extraction and per-file antivirus scans are the main cause of slow installs). Development still uses `dsh-runtime/` directly.
- PowerShell for agent commands on Windows: inside the sandbox, Windows PowerShell 5.1 takes 20–30 seconds per command and PowerShell 7 about 1 second. The app picks, in order: a working PowerShell 7 already on the system (tried once in the background the way DSH runs it; nothing is downloaded) → the app's private PowerShell 7 → Windows PowerShell 5.1. When no working 7 exists and agent mode is on, the app downloads the official PowerShell 7.6.9 (LTS) zip in the background into `%LOCALAPPDATA%\AnyModelBot\pwsh\`: no admin rights, no registry writes, no PATH changes, and your own PowerShell is untouched. The version and the SHA256 of the x64 / arm64 zips are pinned in `src/agent/pwsh-private.ts` (bump them with `node scripts/pwsh-hashes.mjs <version>`). After download the hash is checked, after extraction Microsoft's Authenticode signature is checked, and it is only used after a DSH-style trial run (version, read/write a temp file, launch an external program) passes; failed or half-finished installs are never used and are cleaned up on the next launch. While installing, the chat screen and Settings → General show progress, and so does `/status`; commands keep using 5.1 until it is ready, and idle agent processes switch over in the background without restarting the app. If the agent cannot start it at runtime (removed or quarantined by antivirus, blocked by policy), the app falls back to the previous option and says why; Settings → Troubleshooting can install, reinstall or revert to the system default. Nothing is downloaded on systems older than Windows 10 1607 / Server 2016. The desktop app downloads through the system proxy (Chromium network stack); the command-line build uses Node's fetch (newer Node versions honour `HTTPS_PROXY` when `NODE_USE_ENV_PROXY=1`). `AMB_PWSH_MIRROR` switches to a mirror prefix (hash and signature are still checked), and `AMB_PWSH_AUTO_INSTALL=0` turns automatic installation off.
- Agent commands have network access (the sandbox only restricts writes) and use your proxy: `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` (and their lowercase forms) and the certificate and package-index variables (`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `PIP_INDEX_URL`, `npm_config_registry`, `GOPROXY`, …) are passed through from the app's environment; when the environment sets no proxy, the desktop app asks for the system proxy (system settings and PAC) each time it starts the agent process and passes it on as `http://host:port` (see `src/agent/proxy-env.ts`). Loopback (`127.0.0.1`, `localhost`, `::1`) is always added to `NO_PROXY` and never proxied.
- Data directory: `<userData>/data` (macOS `~/Library/Application Support/anymodel bot/data`, Windows `%APPDATA%\anymodel bot\data`, Linux `~/.config/anymodel bot/data`). Logs are in `logs/app.log` inside the data directory.
- Single instance; closing the window hides to the tray by default (Settings → General can make it quit instead). Tray menu: Open / Open in browser / Launch at login (macOS, Windows) / Open data folder / Quit.
- On macOS the window has no title bar and the traffic lights sit at the top of the sidebar; minimum window width is 860.
- The console listens on 127.0.0.1 only and generates a random access token on every launch, so other local programs cannot call the management API directly.
- On quit, channels stop first, then magpie. If a previous run was killed and left a magpie process behind, the next launch cleans it up (Linux/macOS).

Releases: bump `version` in `package.json`, commit, and push a `v<version>` tag. `.github/workflows/release.yml` builds on each of the six OS / architecture runners and publishes the installers plus `SHA256SUMS` to a GitHub Release. The repository secrets needed for signing and notarization are described in the comment at the top of that file. The same tag also starts `.github/workflows/docker.yml`, which publishes the x64 + arm64 image to `ghcr.io/modelflare-ai/anymodel-bot` (tagged `<version>` and `latest`).

## Docker

Users run the published image: `docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot`. To build it from source yourself:

```bash
git submodule update --init --depth 1 vendor/magpie
docker build -t anymodel-bot .
docker run -d --name amb -p 3600:3600 -v amb-data:/data anymodel-bot
docker exec amb cat /data/ui-token     # open http://<host>:3600/?token=<token>
```

Inside the container the console listens on 0.0.0.0, so token access is enforced. Do not expose port 3600 directly to the internet. WeChat QR sign-in is in the chat screen's info panel (click the bot name at the top) → Channels.

## Models (Modelflare)

- First launch shows a single button, "Sign in / Sign up for Modelflare": sign in in your system browser (you can sign up on the spot) and click Continue to authorize. Back in the app, a dedicated API key is issued for this computer and connected → pick a default model → start chatting. Docker and remote deployments cannot receive the browser callback, so their first-run screen asks for an API key instead (validated with `GET https://modelflare.dev/v1/models`).
- Sign-in method: OIDC authorization code + PKCE (RFC 7636), as a native app per RFC 8252. The app is a public client (`client_id` is `anymodel-bot`; it has and needs no client secret), and the authorization result is delivered to a temporary port on `127.0.0.1`. You can revoke access at any time under "Authorized apps" on your Modelflare profile page; the app notices and returns to the sign-in screen.
- The account credential (refresh token) is stored in `modelflare-account.json` in the data directory (mode 600); the desktop app encrypts it with the system keychain (Electron safeStorage). The UI only receives the account name. "Sign out" revokes this computer's authorization, and Modelflare deletes the keys it issued for it and its bots at sign-in.
- Balance: the bottom-left of the sidebar and Settings → Modelflare show the wallet balance (with only an API key, it reads `/v1/dashboard/billing/credit_grants`). "Top up" opens the Modelflare website, and the balance refreshes when you return to the window. When the balance drops below the reminder threshold (1 US dollar by default; adjustable or off), the app reminds you once, and can also have a bot message you on WeChat / Feishu.
- When signed in, Settings → Modelflare also shows usage per day and per model, notifications from Modelflare, and your invite link.
- Bot budgets (requires sign-in): Bot settings → Budget. When enabled, the bot uses its own key (a separate provider in the gateway) capped at the dollar amount you set; when disabled it goes back to the shared key.
- Image / video generation: in agent mode, bots get four tools — `media_models` (available models, defaults, parameter ranges, reference prices), `media_docs` (reads the model's request format live from docs.modelflare.dev), `generate_image` and `generate_video` — plus a bundled media skill. Parameter formats differ per model, so the bot writes the request body from the docs; reference images in the workspace are written as `workspace:path`. The key never leaves the app: the app calls Modelflare with the bot's key, saves results in the bot workspace's `media/`, and delivers them to the chat.
- Confirmation before generation: the image or video is generated right away. A model other than the default, or a loose request, is not a reason to ask: the bot takes the most reasonable reading, generates, and says in one line what it used. The chat asks which model to use (with prompt, parameters, reference price and the reason for asking) only when the estimated cost is above $0.5 (from the reference price, number of images, video length and resolution; a video whose cost cannot be estimated counts too). You can confirm, switch models or cancel — reply with a number or model name on WeChat, or click on Feishu / the web console. With no answer within 10 minutes, nothing is generated. To confirm every time: bot settings → Images / videos → Confirm before generating → "Every time".
- Web search: the agent's `web_search` does not use DeepSeek's built-in search (it needs a DeepSeek key); the `amb-web-search` plugin hands each search to the app. By default it is free and needs no setup: it tries Exa's public MCP, Bing and DuckDuckGo in turn, the last one that worked first, and skips one that fails (rate limit, bot check, Bing returning unrelated results) for 10 minutes. Settings → Network & access → Web search can switch to Tavily, Exa, Bocha or Zhipu (with a key) or your own SearXNG; when set, it is tried first and the free search takes over if it fails. Keys are stored in the local database like channel tokens and never reach the agent process. The desktop app searches through the system proxy; the command-line build uses Node's fetch (it honours `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1`).
- Connected accounts (`src/agent/accounts.ts`): one global list (Settings › Connections) shared by all bots, with as many accounts per service as you like, so you can tell any bot "check my first Feishu and my second Feishu". The `amb-connections` plugin hands each tool call to the app over the bridge, so tokens never reach the agent process. A tool's `account` parameter picks the account by number or name, and `connected_accounts` lists them. A service's tools only exist once it has an account. Read-only bots and observing rules can't write, and the host checks this again. Chat channels aren't part of this: each bot still has its own.
  - **Notion** (`notion.ts`): when adding an account the user picks one-click authorization or a token. Tokens use the REST API. One-click uses OAuth with PKCE and dynamic registration, calls back to the local `/oauth/notion/callback`, and the app then calls the tools of Notion's remote MCP (`mcp.notion.com`). The model sees the same tools either way: `notion_search`, `notion_read_page` and `notion_query_database`, plus `notion_create_page` and `notion_update_page` for bots that aren't read-only. No tool deletes a page.
  - **Feishu** (`feishu-account.ts`): the same flow as the official lark-cli: scan to create a personal app (or enter your own app), then device authorization for a user token. Read-only, with `feishu_list_chats`, `feishu_read_chat` and `feishu_search_messages`.
- Default image / video models: chosen together with the default text model during first-run setup, changeable later in Settings → Modelflare. "Auto" uses the first model in the recommended order that needs no reference material.
- The model picker shows context length, vision / tools / reasoning capabilities, and starting reference prices per million input / output tokens (from the public price catalog; your bill is authoritative).
- Attribution: requests through Modelflare carry `X-Modelflare-Skill: anymodel-bot/<version>`, and links carry `utm_source=anymodelbot&utm_campaign=amb_<placement>` (`amb_signup`, `amb_topup`, `amb_console` and so on inside the app, `amb_readme` for the README and repository docs, `amb_homepage` for the website; `test/utm.unit.test.ts` pins the format).
- Routes: the international route `https://modelflare.dev/v1` is the default; in mainland China you can pick "Optimized for mainland China" (`https://origin.modelflare.dev/v1`) under Advanced or Settings → Modelflare → Route. You choose the route; it never switches automatically.
- Settings → Modelflare: account, balance and top-up, balance reminder, usage, notifications, invites; connection status (only the key's last characters are shown); when not signed in you can replace the key or disconnect (bots and sessions are kept; disconnecting returns to the first-connection screen); default model, refresh model list.
- The model button to the right of the composer switches the model for the current session (or sets it as the bot default); `/model`, `/reset`, `/new`, `/status`, `/stop` and `/help` all work.
- Activity: every step of an agent turn (model requests with timing and tokens, tool calls with arguments and output, retries, sub-agents) is folded into the "time" line above the reply; click to expand. For WeChat / Feishu sessions, see info panel → Recent sessions, where the turn in progress is shown live and can be aborted.
- Stuck messages: `/stop` (any channel) or "Abort" in the info panel ends the current turn immediately. A turn with no progress for 10 minutes (no model reply, no tool activity, only retries; waiting for your approval or answer does not count) is aborted automatically, and a single turn is capped at 30 minutes (`AMB_AGENT_IDLE_TIMEOUT_MS`, `AMB_AGENT_TURN_TIMEOUT_MS`). Aborting stops only that conversation's turn (the amb-control plugin inside the agent process cancels it); the bot's other conversations keep running. Only if it has not stopped within 10 seconds (`AMB_STOP_GRACE_MS`) is the agent process restarted. `/status` shows which step it reached and how long since the last progress. In the web chat, switching to another bot or reloading the window does not interrupt a message in progress; when you return it picks up where it was (your message, the reply so far and the activity). The stop button also works while queued, while the agent is starting and while waiting for approval, and for plain chat too.
- Steering: a message (text, images, files) sent while the agent is working joins the current turn; the model sees it at its next step and one reply covers both (you get a short "received" first, sent through the outbox and dropped if it cannot go out within 10 minutes). Steered messages pass the same admission check as any other: a message from someone not on the allowlist never joins a turn. Before the agent has taken the previous message, or while the turn is finishing, it queues as before, and so do commands (`/model`, `/reset`…). In the web chat you can keep typing while a reply is in progress.
- Long commands move to the background: a command still running after 30 seconds (60 for PowerShell on Windows) becomes a background job instead of blocking the turn, and the agent replies that it is still running. When it ends the agent is woken with the result and its reply arrives as a new message in the same conversation (live in the web chat; on WeChat and Feishu it goes through the outbox like any reply: its id is derived from the agent session and turn so it is sent once, WeChat's 24-hour window and quota are checked at send time, and on Feishu it replies to your latest message, whose id is kept in the database). The activity shows the background command's steps, and `/status`, abort and the watchdog treat that turn like any other.
- Each conversation uses its own model: inside one agent process every conversation runs on its own model and API (one provider per API, context window and max output per model). Switching models does not restart the agent process; a model the launch patch did not list is added at runtime.
- Replacing the agent process: the DSH SDK cannot close a session, so every background task's session and every rule run's session stays in the agent process until it restarts (measured: about 0.25–0.45 MB per finished, idle session). Once a process has opened more than 100 of them, it is replaced in the background as soon as it is fully idle: no chat turn, no task or rule run running or settling, no pending approval, no compaction, no background job in the process. Sessions carry on as before, nothing is interrupted and the user sees nothing. The troubleshooting agent status shows `taskSessions` and `recycles`; `AMB_DSH_RECYCLE_SESSIONS` changes the threshold.
- Notice after a restart: a message still being handled when the app quit or crashed (each conversation keeps an in-progress marker in the database, removed when the message is done) is reported once in its conversation at the next start — "上次的消息「…」因为应用重启没有处理完，请重新发送" (the last message was not finished because the app restarted; please send it again). Nothing is resent automatically. The web chat gets it in its history; WeChat uses the stored context_token and the same reply quota, and when the 24-hour window or the quota has run out it is said before the reply to your next message in that conversation; Feishu sends it to the original chat.
- Agent API: the agent picks the API from what the Modelflare public catalog says the model supports — models with the Responses API (GPT-5.4 and later, Grok 4.5 and later, DeepSeek V4, GLM-5, Kimi K3 and others) use `/v1/responses` (reasoning models default to medium effort; encrypted reasoning is replayed with history); models without Responses but with Anthropic Messages (Claude) use `/v1/messages`; all other models, the case where the catalog is unavailable (offline, the mainland China route) and external endpoints use Chat Completions. The API is chosen per model the first time the agent process uses it (the agent status under Troubleshooting shows the last turn's `api` and the models in the process); `AMB_AGENT_API=chat` forces Chat Completions everywhere (for troubleshooting). Plain chat (non-agent) still uses Chat Completions. Safety net: when the upstream rejects a model's Responses / Messages request (HTTP 400/404/405/415/422 or "unsupported parameter / endpoint"; rate limits, balance, permissions, upstream outages and context overflows do not count), that model switches to Chat Completions for 24 hours (recorded in `dsh/api-fallback.json` in the data directory, with a warning in the log, and the agent status shows `openai-completions (fallback: reason)`). If the turn has not called any tool yet, that conversation redoes it on Chat automatically (without restarting the agent process) and the user still gets a reply; if it already called tools, the error is reported and the next turn uses Chat.
- Built-in gateway: magpie runs in `--gateway` mode with its own HOME / config directory inside the app's data directory. It **does not read** existing Claude / Codex subscription credentials on your computer, **does not rewrite** any agent configuration, and has auto-update and account discovery turned off. It is only called from inside the app process; the console no longer proxies its pages or `/v1`.
- The API key is stored only in the gateway's isolated configuration — never on a command line, never in logs — and the front end only receives its last characters.
- Development / testing: `AMB_MAGPIE_BASE_URL` points the app at any OpenAI-compatible endpoint (the gateway is not started, the UI treats itself as connected, and account features are unavailable); `AMB_MODELFLARE_BASE_URL` points the Modelflare base URL at a local mock, and `AMB_MODELFLARE_ISSUER` points sign-in and account APIs at a local mock.

## Interface

- Sidebar: bot list (avatar + name + latest message), ＋ New, right-click to rename / delete; the account button at the bottom-left opens Settings (`⌘/Ctrl+,`).
- Chat screen: the floating bot-name pill at the top opens the info panel (`⌘/Ctrl+⇧+I`: channels, requests, pending approvals, tasks and rules, memory, recent sessions; ⚙ opens bot settings). Replies stream in (Markdown, one-click copy for code blocks) and can be stopped at any time (`Esc`). Approvals and questions appear as cards in the chat. Scrolling up is never yanked back to the bottom.
- Command palette `⌘/Ctrl+K`; appearance (system / light / dark) is in Settings → General.
- Language: 简体中文 / English, in Settings → General → Language (also at the top-right of the onboarding screen and in the command palette). It follows the system by default (English when the system language is neither Chinese nor English). The preference is stored in `ui.lang` in config.json; the tray menu, server error and status messages, and system messages bots send to WeChat / Feishu (`/help`, approval prompts, …) all follow it. On the command line / Docker, "System" means `AMB_LANG`, then `LC_ALL` / `LANG`, falling back to Simplified Chinese. Logs, prompts sent to the model and bot names users chose are not translated.
  - UI strings live in `ui/locales/<lang>/<namespace>.js` and are used as `t("namespace.key", { params })` (`ui/lib/i18n.js`); server strings live in `src/i18n/messages/<namespace>.ts` with type-checked keys. Every UI request carries `x-amb-lang`, and the server answers that request in the same language.
  - Add every new string in both languages. `node scripts/i18n-check.mjs [files…]` reports Chinese left in UI code, keys that don't exist, and zh / en dictionaries that are out of sync (`test/i18n.unit.test.ts` in `npm test` checks the same). Chinese that must stay in code (font names, regexes matching Chinese input) gets a `// i18n-ignore` on that line.
- Onboarding checklist: the empty chat state shows a six-step checklist — say hello, switch models, connect WeChat, let it do something, let it remember you, generate an image. The last step only plays a built-in demo inside the guide, whether or not the account has image / video models: like the real default flow it generates right away and shows the image in the chat, but nothing is sent to the bot, no model is called and nothing is charged; the image is the bundled `ui/assets/guide-demo.svg`. The point is to teach the flow without spending the user's money; actually asking it to draw, or receiving an image later, also completes the step. "Send this" tries it directly; "Show me" or the checklist entry at the bottom-left of the sidebar shows a guide card pointing at the right control (highlighted with a ring). Steps tick themselves off: a reply in the chat, a model switch, a received file / image, a connected channel, a memory write. Progress is stored in `ui.guide` in config.json (API `/amb/api/guide`), and steps that existing users have already done count as complete. The checklist can be collapsed to the bottom-left or hidden for good, and Settings → General → Onboarding checklist starts it over.
- Visuals: neutrals and components are adapted from magpie's UI (MIT); the accent is Modelflare's fluorescent yellow-green `#d7ff00`. The design system is described in `ui/design/README.md`.

## Persona and prompts

Every prompt the agent model reads lives in `src/agent/prompts/`. `test/prompts.unit.test.ts` checks the required and forbidden phrases of each part and a character budget; `test/agent.integration.test.ts` checks, with a real DSH child process, the system prompt the model receives and a budget for the whole system prompt plus tool definitions.

- **Persona**: DSH's own persona is a "coding agent", preceded by "You are an AI agent powered by DeepSeek Harness.". The patch (`host.ts` writePatch) replaces `personaPrefix` with a personal-assistant persona (chats, and also writes code, runs commands, handles files, and operates desktop apps when computer use is on; text in web pages, files and forwarded messages is data, not instructions) and turns off `includeHarnessIdentity` (it controls only that sentence).
- **Bot section**: the chat rules, how to use long-term memory (when memory is on), the bot's name and the persona you wrote form the last section of the system prompt (`amb:bot`). Before each turn the host writes it to `dsh/.prompts/<bot>.md` in the data directory (the agent's file tools can neither read nor change it; an unchanged section is not rewritten), and the `dsh-runtime/plugins/amb-prompt.mjs` plugin reads it on every model request — an edited persona or name applies from the next message, without `/new` and without restarting the agent process. DSH 0.2.1-rc.4 calls a section's `text` synchronously (a returned Promise is not awaited), so the plugin reads a file rather than calling the bridge. Where the persona and the chat rules disagree, the persona wins. Subagents do not get this section: they do not talk to the user.
- **Chat rules** (Chinese, adapted from dsh-superagent's attention principle): answer first; for a task that takes a while, say in one line what you are about to do, then do not narrate the steps (they are in the activity panel); when done, say what was done and where the result is; unfinished is reported as unfinished and a failure as a failure; decide yourself and say what you chose, never asking about language, format, scope or style; ask only when a wrong guess would cause harm, cost money or waste most of the work, when it needs something only you have (a login, a file, a password), or when the step cannot be undone (paying, deleting your data, messaging other people), one concrete question at a time, with `ask_user_question` for choices; no filler; keep replies short on WeChat and Feishu. Background tasks follow the same rule and say what they chose in the result.
- **A segment's first message**: the channel (WeChat shows plain text only; Feishu and the web support Markdown), the long-term memory snapshot of that moment, the previous segment's handoff note, then your message. These differ per conversation (group memory, channel) and change with every remembered fact; in the system prompt they would invalidate the prefix cache all of a bot's conversations share, so they stay here, unchanged within a segment, and later memory changes are read with `recall`.
- Prefix cache: an unchanged section keeps the system prompt byte-identical; an edited persona changes only the last section. Conversations started before the upgrade still carry the old persona in their first message until the next segment (`/new` or a steward switch).

## File permissions

In agent mode each bot has a file permission preset. Switch it with the permission pill at the bottom-left of the composer or in Bot settings → Permissions; `/status` shows the current preset:

- **Workspace write** (default): commands run in a sandbox and can only change this bot's workspace; anything outside asks you in the chat first.
- **Read-only**: no file changes; commands run in a read-only sandbox.
- **Full access**: for users who understand the risk and find approvals too frequent. Commands run **without a sandbox**, directly as your user, and out-of-bounds actions no longer ask — it can read and change any file on your computer, including AnyModelBot's own data directory (database, channel tokens, keys). Only **recursive deletes** still ask first (same approval flow: reply with a number on WeChat, cards on Feishu / web): `rm -r` / `-rf` / `--recursive` (including inside `sudo`, `xargs`, `sh -c`), `find -delete`, `git clean`, `rsync --delete`, PowerShell `Remove-Item` / `rm` / `del` / `rd` / `rmdir` with `-Recurse` (and abbreviations), cmd `rd /s`, `del /s`, `robocopy /MIR`, plus common forms such as Python `shutil.rmtree` and Node `fs.rm(…, { recursive })`; script files named in the command are checked too. Choosing it shows a confirmation first, and the permission pill and settings page mark it in red.
  - This is a guard against accidental deletion, not a security boundary: it inspects the command text, so commands assembled at runtime (`eval "$(…)"`, `curl … | sh`) and build scripts such as `make clean` or `npm run clean` are invisible to it; when in doubt it asks. Only enable it when you trust the current model and task.

## Who can use a bot

The agent runs on your own computer (possibly with full access), so by default **only the owner and people you allow** can talk to a bot, per bot and per channel (`src/core/access.ts`):

- **Owner**: on WeChat, the account that scanned the QR code. Feishu connects with an App ID and App Secret and no scan, so **the first person to message the bot one-to-one after it is connected** becomes the owner (trust on first use): once it is connected, send the bot one line from your own Feishu, and that message is answered as usual. A WeChat login that did not report the scanner's id works the same way. Bot settings → Who can use shows the Feishu owner; "Change" (after a confirmation) clears the owner so the next person to message becomes the owner. Switching to another Feishu app or disconnecting Feishu clears it too. People who were denied never become the owner. The local web chat is never restricted.
- **Anyone else** gets a single line, "you are not allowed to use this bot yet, the owner has been told" (at most once an hour per person); the message is not queued, no model is called and nothing is spent. The request shows in the info panel (allow / deny) and is sent to the owner with a 4-digit pairing code (at most 3 per bot per hour, and only if the owner spoke on that channel in the last 24 hours); the owner replies `同意 1234` / `拒绝 1234` (or `yes 1234` / `no 1234`) in chat. Pairing codes never collide with tool-approval codes. People who were denied get no reply at all.
- The allowlist is in Bot settings → Who can use; entries can be removed (they can ask again by sending a message). `/status` shows it too.
- On upgrade, everyone who already had a direct conversation with a bot is put on its allowlist (marked "used before the upgrade"), so nobody is cut off; re-scanning with another WeChat account keeps the previous owner on the list.
- Group chats: no channel delivers them today (Feishu handles direct messages only, WeChat iLink has no groups), so group messages are left as they were; rules go into `access.ts` when a channel adds groups.

## Replies are not lost

Final replies, delivered files, approval prompts and notices are written to an outbox in the local database before they are sent (`src/core/outbox.ts`; streaming card updates and the typing indicator are not):

- Messages to one conversation go out one at a time, in order. Network or platform errors are retried (from 5 s, backing off to 5 min); a channel that is offline is waited for.
- After the app quits or crashes, it carries on at the next start, and what was already sent is not sent again (a long reply resumes from the first unsent part). Ids are derived from the incoming message, so a message the platform delivers twice still gets one final reply; only the part that was in flight at the moment of a crash may go out twice, and it carries a fixed Feishu `uuid` (Feishu dedupes for an hour) and WeChat `client_id`.
- WeChat only lets a bot reply within 24 hours of the person's last message, and at most 10 times per message. A message that cannot go out for that reason is held, not dropped: the next time the person writes, held messages go out first, before the reply, in their original order and only once, with the text ones merged into one "你不在时：…" ("While you were away: …") message when they fit in one WeChat message (files go as they are). Held messages are kept for up to 7 days; short-lived ones such as the "received" note and approval prompts keep their own deadline.
- Messages that can no longer be sent (repeated platform rejections, waiting too long) are marked with the reason in the log and the diagnostics.

## Background tasks and rules

Work that takes a while runs in the background and never holds up chat (design: `docs/design/background-tasks-and-proactive.md`; code: `src/tasks/`):

- **Background tasks**: the chat agent starts one with `task_start` (its own DSH session `task-<id>` and a folder `tasks/<name>-<id6>/` in the workspace) and says in one line what it will do; the result comes back to the conversation that asked (quote it in WeChat or reply to it in Feishu to follow up). A task that needs you asks one question at a time per conversation. After an app restart it carries on and checks before repeating outside actions. `/tasks` lists tasks and rules, `/stop <number>` stops one.
- **Rules**: made with `rule_create` or in bot settings › Proactive messages › Rules, and they act right away: your own words are the mandate, so each run checks and sends a line only when something matters, and editing the words keeps it acting. Observe mode is opt-in (tell the bot "observe first", or pick Observe in the rule editor): read-only, sends nothing, records "would send", and after 3 observed runs Needs you asks whether to switch it to act. Each run gets a fresh session, and the run log exports as Markdown.
- **Visible, not noisy**: the info panel's Tasks group lists the bot's tasks and rules (ended tasks fold into one "ended" row); open one to see where it came from, the latest progress, the budget, the folder and each run's steps. Everything waiting on you is in the sidebar's Needs you. Only results, decisions and failures are pushed; quiet hours (22:00–08:00 by default), daily caps (3 on WeChat, 5 on Feishu) and digests are in bot settings › Proactive messages.
- **Budgets**: $1 per task, $0.10 per rule run and $3 per rule per month by default (estimated from Modelflare's reference prices). At the limit the work stops and asks; change a task's budget in its details and a rule's in the rule editor. When the bot's budget key is below 20 %, background work stops so chat keeps the rest.
- **Pause**: bot settings › Proactive messages › Pause background work (or ask the bot) holds tasks, rules and pushed messages; chat carries on.
- **Retention**: tasks and run logs are kept for 30 days; a task unused for 30 days is archived. A task folder unused for 30 days is deleted along with the task's DSH session files (under `dsh/<bot>/sessions/`; the SDK has no call to delete a session, so the app removes the files itself, and a session still open in the agent process is removed after the process is replaced). You are not asked and get no notification: at 27 idle days the deletion date is set and shown in the task details, where Keep holds on to the folder (it is never deleted sooner than 3 days after the date is set). The task details show the folder's size and can delete the task with its folder.

## Computer use

Each bot can turn computer use on or off, choose a backend and an approval mode in Bot settings (⚙ in the info panel) → Computer use; `/status` and the settings page show the current backend, whether it is available, and why not.

- **Backends**
  - **Cua Driver (default, all three desktop platforms)**: the official prebuilt [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver) 0.37.0 (MIT) ships with the installer; `scripts/fetch-cua-driver.mjs` downloads it per platform / architecture at build time and verifies its SHA256. It runs as the built-in MCP server `cua-driver mcp`, always with `CUA_DRIVER_PERMISSION_MODE=bounded` plus a capability manifest, and **never** with `--dangerously-bypass-approvals`. The child process environment is scrubbed (no secrets passed), telemetry is off, and `run_script` is disabled. Only the 24 tools it needs are exposed (read windows / screenshots, launch apps, click, type, press keys, key combos, scroll, drag, set values, menus, and so on); everything else (scripts, killing processes, clipboard, browser injection, recording, updates, …) is invisible to the model and refused. The manifest lists the GUI apps installed on the machine (Linux reads .desktop files, macOS reads /Applications, Windows reads the Start menu) and allows full-screen input; it is valid for at most 24 hours and the driver restarts before it expires.
  - **Codex Computer Use bridge (optional, macOS only)**: kimi-computer-use. Requires OpenAI Codex Computer Use to be installed locally; falls back to Cua Driver when unavailable.
- **Approvals**: by default all computer-use actions (read, screenshot, click, type, key press, scroll, drag, set value) **run automatically without approval**. Optionally, "ask me before actions that change the screen, such as clicks and typing" (reading the screen stays automatic). On upgrade, existing bots (including the default bot) are migrated to automatic. Bots with the read-only preset only get read tools.
- **Platform notes**
  - macOS: grant the app Accessibility and Screen Recording in System Settings → Privacy & Security; the driver runs in `--direct` mode (not yet verified on real machines).
  - Linux: on X11 the UI is read through AT-SPI (requires at-spi2-core and apps with accessibility enabled); Wayland is degraded — only the foreground window of XWayland apps can be operated, and the UI says so. Unavailable without a graphical session (DISPLAY / WAYLAND_DISPLAY).
  - Windows: must run in the interactive desktop session of a signed-in user (non-interactive sessions of services / scheduled tasks are not supported).
- Screenshots are only sent to (vision-capable) models. They are not forwarded to WeChat / Feishu chats, and are only sent as files when the user asks.
- Not bundled: cua-perception, OmniParser (AGPL) and any Cua Spaces (FSL) components.

## Feishu app setup

1. Open the [Feishu Open Platform](https://open.feishu.cn/app) → create a custom enterprise app and add the Bot capability.
2. Under Permissions, enable:
   - `im:message.p2p_msg:readonly` (read one-to-one messages users send to the bot)
   - `im:message:send_as_bot` (send messages as the app)
   - `cardkit:card:write` (create and update cards, used for streaming replies)
   - `im:message.history:readonly` (read chat history: the long connection doesn't re-push messages sent while the app was offline, so on start and after a reconnect the app catches up from history on chats active in the last 7 days, taking messages from the last 24 hours, at most 20 per chat. Without it everything else works, but nothing is caught up, and the app says so once)
3. First enter the App ID / App Secret in this app's info panel → Channels → Feishu and save (the long connection must be online before the next step can be saved).
4. Events & callbacks → subscription mode: "**Receive events through persistent connection**", and add the event `im.message.receive_v1`.
5. Publish a version, add yourself to the availability scope, then send the bot one line from your own Feishu: the first person to message it after it is connected becomes its Feishu owner (see "Who can use a bot").

Note: only one-to-one (p2p) chats are handled for now; group messages are ignored.

## WeChat (iLink)

- Info panel → Channels → WeChat → "Scan to sign in", scan the QR code with WeChat and confirm; or run `npm run weixin:login` (the QR code is shown in the terminal and saved as a PNG in the data directory).
- Sign-in state, sync cursor and context_token are kept in the data directory and resume after a restart.
- Platform limits: after each user message, at most 10 replies can be sent within 24 hours; replies are sent in one go once generation finishes and are split above 4000 characters; "typing…" is shown while generating.
- Images, files, videos: whatever the user sends (or quotes) is downloaded from the WeChat CDN and decrypted (up to 50 MB each). In agent mode it is saved in the bot workspace's `inbox/` and the message names the path, so the agent can read it, process it or use it as a reference image for generation. Vision-capable models (Claude, GPT-5/6, Gemini, Grok 4, Kimi K3, Muse Spark and others) also receive the image itself; other models only get the path. On Linux the agent does not receive images directly yet (sharp crashes under Electron) and only gets the path. Files the bot delivers (present) go back to WeChat as images or files.
- When the session expires (error code -14), the channel pauses and the UI says so; scan again to resume.

## Development and tests

```bash
npm run typecheck
npm test            # unit tests + offline end-to-end (mock Feishu / iLink / Modelflare, including streaming and stop) + gateway integration tests (requires a compiled magpie)
npm run docs:check  # README self-check: assets present and within size, zh/en structure parity, relative links and anchors, banned wording, alt text
```

The README asset list and recording spec are in [docs/assets/README.md](./assets/README.md).

## License

MIT, see `LICENSE`. Third-party components (magpie MIT — including the adapted UI styles, Tencent openclaw-weixin MIT, and others) are listed in `THIRD_PARTY_NOTICES.md` and in Settings → About.
