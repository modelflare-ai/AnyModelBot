# Catalog bot framework

[简体中文](./bot-framework.md)

A bot is a folder. The app contains no code for any single bot, so shipping a new bot needs no app release. Whoever builds it, and however many there are, every bot passes the same checks, so consistency and safety come from the framework.

While the catalog is empty, existing users see no change: no new sidebar entries, and the same onboarding.

## Getting started

You need Node.js 22.13+:

```bash
git clone git@github.com:modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run bot -- new <id>            # scaffold bots/<id>/ from the template
npm run bot -- check bots/<id>     # static checks; fails until every TODO is filled in
```

Once `check` passes, ask someone to judge whether it's worth shipping, then commit directly to master. There's no need for a PR.

## Architecture

```text
Authors (people / Claude + the dev skill / a pipeline later)
        │
        ▼
Bot package: bots/<id>/ ──► checks ──► human look ──► dist/catalog ──► app installer
                                                                          │
                                                                          ▼
App: local catalog · runtime (sandboxed iframe, bridge, state files) · UI kit · bot process
```

| Part | Where | What it does |
| --- | --- | --- |
| Format | `src/botkit/format.ts`, `schema.ts` | `bot.json`, permissions, limits, the JSON Schema subset |
| Checks | `src/botkit/check.ts`, `render.ts`, `evals.ts` | Static rules, rendering, real-model evals |
| Publishing | `src/botkit/bundle.ts`, `pack.ts`, `sign.ts` | Content-addressed bundles, signed catalog, takedowns |
| Catalog loading | `src/botkit/catalog.ts`, `config.ts` | Read bundled resources, verify and extract locally; remote catalogs require explicit configuration |
| Instances | `src/botkit/installer.ts`, `app-skill.ts` | Install on first use, update, take down, remove |
| Server | `src/web/botapp.ts`, `src/botkit/static.ts` | Catalog and instance APIs; static UI routes with CSP (also used by `amb-bot check` rendering) |
| UI kit | `ui/botkit/` | The only thing a bot's UI may import |
| Container | `ui/screens/bot-app.js`, `discover.js`, `ui/lib/bot-bridge.js` | iframe, bridge, composer, Discover page |
| Permissions | `src/agent/host.ts`, `dsh-runtime/plugins/amb-bot-gate.mjs` | Undeclared permissions are refused at runtime |
| Tooling | `src/cli/amb-bot.ts`, `assets/bot-template/` | The `amb-bot` command and the template |

## Bot package

```text
bots/<id>/
  bot.json           Metadata: name, summary, avatar, permissions, starters, imported skills, version
  persona.md         Persona and system prompt
  skills/            Skills. Imported skills live here too and ship with the catalog
  ui/                The UI: index.html, static files, locales/
  state.schema.json  The data contract between the UI and the bot
  sample.<lang>.json Sample data shown on open, in the user's language. zh-CN and en are required; other languages fall back to en
  evals/             tasks.json (eval tasks), injection.json (prompt injection cases)
  cover/             Optional: Discover cover art, light.png and dark.png
```

### Cover

A Discover card opens with a cover image: `cover/light.png` and `cover/dark.png`, switched with the UI theme. Packing uses it first, falls back to the UI screenshot in `.check/`, and shows the avatar when neither exists.

- Draw what the bot does (a scene, its props), not the bot's avatar on its own: the avatar already sits next to the card's name.
- Official covers are one series: a small felt and fabric still life made from the bot's own avatar, in its materials and colors, built from the accessory on its head and the props of its work (PPT Master: three slide cards in a lavender felt stand; Company Research: a mustard herringbone dossier and a brass magnifying glass; Film Studio: a black felt clapperboard and a brass film reel; US Stock Research: lime plush bars under a neon trend arrow). Use a light neutral grey seamless backdrop, center the objects with generous space around them (big cards crop again to 16:9), and let the objects carry all the color; no text, logos, people or robots. Make the dark version with an image edit (images/edits) of the light one: the same composition re-lit on a charcoal backdrop. Draw at 1536×1024 with gpt-image-2.5, then crop to 16:10 and reduce to a 256-color PNG:

  ```bash
  ffmpeg -i in.png -vf "crop=1536:960,scale=1200:750:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" -compression_level 9 cover/light.png
  ```

- It must be a PNG of at most 500 KB per file (the client rejects larger thumbnails from an online catalog, using the UI bundle limit). `amb-bot check` enforces this (`format.cover`).

### bot.json

| Field | Notes |
| --- | --- |
| `id` | Lowercase letters, digits and hyphens, 2–48 characters |
| `version`, `minAppVersion` | Bot version; users on an older app don't see the bot |
| `name`, `summary` | Name (≤ 24 characters), one line (≤ 80 characters) |
| `about` | 1–3 lines shown in the info panel |
| `starters` | 2–3 clickable sentences; each must visibly change the view. Until first use they show as one row of single-line chips above the composer, truncated when they don't fit (hover shows the full text), so keep them short (under about 60 characters in English) |
| `avatar` | A base character (`blue`, `yellow`, `green`, `red`, `purple`, `orange`) or a field expert (`law`, `health`, `finance`, `code`, `design`, `writing`, `education`, `science`, `data`, `marketing`, `cooking`, `translate`). It only sets the look. Older apps don't know the experts, so set `minAppVersion` to the release that added them. It can't match another catalog bot's avatar (packing rejects it). `slides`, `film`, `dossier` and `ticker` are the signature looks of PPT Master, Film Studio, Company Research and US Stock Research, and no other bot can use them |
| `permissions` | See below |
| `skills` | Imported skills: `name`, `source`, `sha256` (from `amb-bot hash`), `author`, `license`, `url`. Your own skills aren't listed |

Text fields are `{ "zh-CN": …, "en": … }`, both required. The framework requires these two; `ja`, `ko`, `ru`, `es` and `pt` fall back to `en`. Bots listed in this repository need all seven languages, including text, UI and sample data, and `test/bot-catalog-site.unit.test.ts` checks this.

### Permissions

| Permission | Allows | When not declared |
| --- | --- | --- |
| `workspace-write` | Writing its own workspace. Required, because the bot writes `app/state.json` | Read-only preset |
| `network` | Web search, fetching pages, network from commands. Asks the user on first use | Tools refused; commands have no network on Linux; scripts that use the network fail static checks |
| `channel-send` | Background tasks, whose results are sent to chat channels. Asks the user on first use | `task_start` and `task_message` refused |
| `computer-use` | Controlling the computer | Not loaded |
| `accounts` | Connected accounts (Notion, Feishu data) | Not loaded |

On macOS and Windows, network access from commands is covered by the static scan; at runtime only tool calls are blocked.

## UI

The UI runs in an iframe with `sandbox="allow-scripts allow-forms"`, so it has an opaque origin: no network (`connect-src 'none'`), no cookies, no access to the app's APIs. All data goes through the bridge and the parent page.

It may only reference the UI kit and files in its own folder:

```html
<link rel="stylesheet" href="/amb/botapp/kit/kit.css" />
<script type="module" src="./app.js"></script>
```

```js
import { html, mount, useBot, Page, Card } from "/amb/botapp/kit/kit.js";

function App() {
  const bot = useBot();
  if (!bot.ready) return null;
  return html`<${Page} title=${bot.state?.title}>…<//>`;
}
mount(App);
```

### useBot()

| Field | Notes |
| --- | --- |
| `ready` | The bridge is ready |
| `state` | Contents of `app/state.json`, with invalid parts removed; updates when the bot changes the file |
| `issues` | What didn't match the contract, for debugging |
| `sample` | Still showing sample data (no instance yet) |
| `busy` | The bot is replying |
| `lang`, `t(key, params)` | Current language and text from `ui/locales/<lang>.json` |
| `send(text, action)` | Send a message as the user. `action` is a UI action; the bot receives `[ui-action] {…}` |
| `stop()` | Stop the current turn |
| `pickFile({ accept, multiple })` | Let the user pick files into `app/inbox/`; returns `[{ name, size, path }]` |
| `readFile(path)` | Read other text files under `app/` (up to 2 MB) |
| `readImage(path)` | Read an image under `app/` (png, jpg, gif, webp, svg, up to 16 MB). Returns `{ url }` for an `<img>`. Needs an instance; images for sample data live under `ui/` and use relative paths |
| `readMedia(path)`, `releaseMedia(url)` | Since 0.1.23, preview audio/video under `app/` (up to 200 MB per file, four simultaneous previews). Returns `{ url, size }` for `<video>` / `<audio>`. Release the URL when switching files or unmounting. The parent passes the media data; Blob URLs are created inside the sandbox |
| `openFile(path, { reveal })` | Open a file under `app/`. Call it from a user click. Opens the right-hand Preview tab; unsupported formats offer download and system opening. `{ reveal: true }` keeps the folder action on desktop |
| `expanded`, `setExpanded(boolean)` | Whether the workspace is expanded; expand from a user click, retaining editor state when restoring. Requires App 0.1.33 or newer |
| `desktop` | This is the desktop app, so files can open with the system app |
| `openUrl(url)` | Preview an external page in the right panel once the user confirms its address; http(s) only, with a browser-opening fallback |

The kit follows the app's theme, language, text size and motion preference on its own.

### Components

`Page`, `Section`, `Card` (`on` adds the highlight background), `Row`, `Stack`, `Grid`, `Button`, `Field`, `Notice`, `Empty`, `Meter`, `Table`, `Link` (an external link the user confirms before it opens). Design system classes (`.btn`, `.field`, `.t-title`…) and tokens (`--fg`, `--well`, `--space-*`, `--fs-*`) work directly; see [ui/design/README.md](../ui/design/README.md). `style` in JS can't hardcode colors, spacing or font sizes either; use it only for computed values, such as a bar's width.

### Desktop workspace

Design for the side panel first. Bots with multiple projects, research runs or jobs use `Workspace({ label, current, children })` from the kit: the first child is navigation, followed by the content. `label` names the list and `current` names the selected project or creation page. The component requires App 0.1.33 or newer:

```js
html`<${Workspace} label=${listTitle} current=${selectedTitle}>
  <nav class="kit-ws-list">
    <div class="kit-list-head"><h2 class="t-label">Projects</h2><button class="btn sm">New</button></div>
    <button class="kit-item on"><span class="kit-item-title">Name</span><span class="kit-item-meta">…</span></button>
  </nav>
  <main class="kit-ws-main">
    <header class="kit-bar"><div class="kit-bar-text"><h1>The selected one</h1><p>Status · one line</p></div><div class="kit-bar-actions">…</div></header>
    <div class="kit-ws-body"><div class="kit-tabs" role="tablist">…</div>…</div>
  </main>
<//>`;
```

- Below an iframe width of 1100px, navigation becomes a compact project picker, dismissed by clicking outside or pressing Escape. At 1100px it becomes a persistent list. The host offers Expand workspace / Back to chat without unmounting the Bot UI.
- `.kit-ws-main` defines the `workspace-content` container. Use container queries for internal columns so they respond to the actual content width after navigation. Existing third-party `<div class="kit-ws">` layouts remain supported.
- The bot's name is already in the host's title bar, so the UI doesn't repeat a big title. Text that never changes, such as a disclaimer, goes in `.kit-foot` at the end instead of the top.
- Choose the primary next action from progress and put secondary actions under More. Keep around four main tabs; open auxiliary tools such as canvas and settings on demand. Fold lengthy descriptions, versions and history; show active generation status beside the current work.
- The host shows starters as one row of single-line chips, so keep starters short; ones that don't fit are truncated.
- Chat occupies the main area and the workspace sits beside it. Expanding the workspace temporarily hides chat; restoring keeps its original width and state. A Bot UI does not build its own chat.
- So that newcomers and experts both get going quickly, give each bot two things: "New" at the top of the list is a wizard — a few choices that the UI writes into one sentence (shown before sending) and passes to `send`; and at least one view experts know, such as key figures in a research note, a source audit, presentation mode or a storyboard sheet.

Add components to `ui/botkit/kit.js` as real bots need them, rather than working around the kit in one bot. The kit ships with the app, so adding to it needs a release. Register new abilities in `KIT_SINCE` in `src/botkit/format.ts`: a bot using one can't have a lower `minAppVersion`, and the check enforces it (`ui.min-app-version`).

### Bridge

`ui/lib/bot-bridge.js` checks `event.source` and only exposes an allowlist. Approval APIs are never exposed.

| Method | Purpose |
| --- | --- |
| `init` | Language, theme, text size, motion, text and basic bot info |
| `readFile`, `readImage` | Read-only access to `app/` in the workspace, with no way out |
| `readMedia`, `releaseMedia` | Read size-limited audio/video and manage preview resources. HTML and scripts are not supported |
| `openFile` | Preview a file under `app/`, with download/system-open actions. Runs only if the parent page confirms the user just clicked |
| `send`, `stop` | Send a message, stop |
| `subscribe` | Receive `turn`, `file` and `env` events |
| `pickFile` | Pick files |
| `openChannels` | Open connection settings so the user can link a chat channel |
| `openUrl` | Preview an external page once the user confirms its address |
| `reportError`, `rendered` | Report an error (falls back to the conversation), rendering finished |

The microphone, camera and external maps aren't available in the first phase. If one is truly needed, work out how to open it safely, then add it to the bridge and the checks.

## Data contract

The bot maintains `app/state.json` in its workspace, shaped by `state.schema.json`. The UI only reads it, and changes data only by asking the bot through `send`. That way, what a bot changes from a chat channel is already there when the user returns to the desktop.

Every catalog bot automatically gets the host-generated `amb-app` skill (`src/botkit/app-skill.ts`). It tells the bot how to read and write this state, how to handle UI actions, and how to reply in chat channels, so none of this belongs in `persona.md`.

Supported schema keywords: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`. Other keywords fail the checks.

Models don't always follow the contract, so files are validated on read. Invalid fields are removed, list items missing required fields are removed, the UI renders what it can, and the problem goes to the local log.

### What the framework doesn't allow

These are runtime limits to design around:

- **No custom tools.** A bot's abilities come from the model's built-in tools, skill instructions and scripts in its skills.
- **Scripts can't call the model or read the user's environment variables.** Steps that need the model are done by the bot and its subagents (the `agent` tool). Use `web_search` for search; the host manages the search API and key from the app's settings.
- **Background tasks can only write to their own folder** (`tasks/<slug>-<id>/`), so they can't write `app/state.json`. Long work that must update the view live runs in the current turn, which has a default limit of 30 minutes.
- **Results go back to the conversation that started the work.** Start it in a chat channel and the result returns there; a bot can't pick another channel.

## User flow

| Action | What happens |
| --- | --- |
| Open | Extracts the bundled UI locally and shows sample data labeled "Sample". No network download, instance, skills, process or model call |
| First message (typed or a starter) | Extracts the bundled runtime locally and verifies its sha256; creates instance `cat-<id>`; sample data becomes the initial state; the bot stays in Mine |
| After that | Works like any bot, including in chat channels (`/bot` reaches it). It stays out of other bots' peer list |
| App update includes new bot bundles | Skills and UI are replaced on next open, preserving project data. Bots whose persona the user edited stop following the catalog; busy bots wait |
| Idle for 10 minutes | The agent process exits and restarts on the next message |
| Remove | Asks whether to keep the data. If not, the workspace and skills are deleted; if so, using it again picks up where it left off |

A bot that was only viewed leaves nothing behind. Once newer bots push it out of the sidebar, it's still in Discover.

## Checks

```bash
npm run bot -- check bots/<id>          # static: seconds, run after every change
npm run bot -- check bots/<id> --full   # optional: adds rendering and the real model; publishing doesn't depend on it
```

| Category | Rule prefix | What it checks |
| --- | --- | --- |
| Format | `format.*` | Required files, valid `bot.json`, no TODOs left, sample data matches the contract |
| Source | `source.*` | Imported skills have an author and source page, an allowed license (MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0), a matching hash, and no symlinks; the runtime bundle stays within the file count and unpacked size limits the client enforces |
| Permissions | `permissions.*`, `risk.*` | Network use must be declared; piping to a shell, deleting outside the workspace, reading secrets, obfuscated execution, persistence and privilege escalation always fail |
| UI | `ui.*` | No hardcoded colors, spacing or font sizes in CSS or JS; no inline scripts or external resources, and `Link` for external links; no network, storage or parent access; ≤ 500 KB compressed; matching zh-CN and en keys |
| Rendering | `render.*` | No errors, blank pages, overflow or contrast problems in light, dark and 390px |
| Behavior | `behavior.*` | Eval completion ≥ 80%, every starter changes the view, written state matches the contract |
| Security | `security.*` | Every prompt injection case passes |

Failures name the exact rule. When a new kind of problem turns up, add a rule to `src/botkit/check.ts`.

Rendering, behavior and security only run under `--full`. `--full` is optional: packing and publishing don't depend on it. Running it needs two things:

- Rendering uses Playwright, which isn't an app dependency: `npm i --no-save playwright && npx playwright install chromium`. Screenshots stay in `.check/` and, once committed, become Discover thumbnails when packing if the bot has no drawn cover (below). With neither, Discover cards show the avatar.
- Evals connect to a running app: install Go 1.26.8+, run `npm run setup && npm start`, and sign in to Modelflare (`--app <url>`, by default the configured local port; set `AMB_UI_TOKEN` if it has a token). They really install the bot and call the model, then clean up.

Eval tasks go in `evals/tasks.json`: `{ id, prompt, changed?, contains?, notContains?, file?, files? }`, at least 3. `file: { name, text }` puts a file in `app/inbox/`. `files` checks outputs against the files themselves: `{ match (a regex for the path), minBytes?, zipHas? (entries the zip must contain), absent? (no such file may exist) }`. Nobody can click approvals during evals: the first-use prompt for a declared permission passes, everything else is denied, and the bot's questions get "go ahead with your recommendation". Injection cases go in `evals/injection.json`: `{ id, prompt, file?: { name, text }, mustNotContain }`, at least 1.

## Publishing and takedowns

Official bots ship with the app. `npm run build` runs `build:catalog`, checks every bot under `bots/`, and writes UI, samples in every language, personas, skills and available thumbnails to `dist/catalog/`. Electron's `dist/**` packaging rule and the Docker image include these resources. No catalog signing key is needed. First preview and installation read local bundles, verify their SHA-256 hashes, and extract them into the data directory. An old remote index cache cannot override the bundled catalog.

`npm start`, `npm run dev` and `npm run init` generate the bundled catalog first. Before invoking `tsx src/main.ts` directly, run `npm run build:catalog`. Official additions, updates and takedowns ship with app releases. The GitHub Release workflow uses the packaged executable to verify that every bundled bot loads and installs with network requests disabled.

The signed-catalog workflow below remains available for deployments that explicitly configure a remote catalog:

The catalog repository looks like this:

```text
bots/<id>/          One folder per bot
catalog.json        { "featured": [id…], "removed": { id: { reason, security? } } }
catalog.lock.json   Last published record per bot, maintained by pack; kept on the release machine
```

```bash
npm run bot -- pack --root . --out dist-catalog            # needs AMB_CATALOG_PRIVATE_KEY
npm run bot -- takedown <id> --root . --reason "why" [--security]
npm run bot -- who-uses <skill> --root .
```

- `pack` runs the static checks on every bot and writes nothing if any fails. It produces `index.json`, `index.json.sig`, `bundles/` and `thumbs/`. Putting them at the catalog URL publishes them.
- Clients explicitly using a remote catalog fetch at startup and every 6 hours (with ETag) and ignore anything that fails verification, including the local cache. UI and skills are verified by sha256.
- After a takedown, run `pack` and publish again; clients pick it up within 24 hours. A normal takedown only notifies users. `--security` stops the process and deletes the skills right away, leaving the user's data alone.
- `.github/workflows/bot-catalog.yml` checks and packs when `bots/**` or `catalog.json` is pushed to master, and keeps the output as a CI artifact. How it reaches production is up to the release environment. Until the repository has `AMB_CATALOG_PRIVATE_KEY`, it only checks and doesn't pack.

### Optional remote catalog

By default the app reads `dist/catalog/` without connecting to `anymodel.bot/catalog/`. Setting `AMB_CATALOG_URL` explicitly selects a remote catalog. `AMB_CATALOG_PUBKEY` sets its public key; when omitted, the old official catalog's public key is used.

- **Private key:** It's kept only on the release machine (`AMB_CATALOG_PRIVATE_KEY`) and never committed. Losing it means changing the public key and releasing the app again, so keep a separate backup.
- **Remote publishing:** On the release machine, pull the latest master, run `pack`, and put the output at the catalog address. This affects only clients explicitly connected to that remote catalog.
- **`catalog.lock.json`:** It stays on the release machine and goes back in the repository root before each `pack`.
- **Website:** The `/bots` page comes from `site/src/data/catalog-bots.json`. After adding a bot or changing its text, run `npm run sync` in `site/`, commit, and deploy the website.
- **Turning the catalog off:** Set `AMB_CATALOG=off` to disable both bundled and remote catalogs. Tests default to this setting; bundled catalogs have separate offline tests.

To test locally without changing code, set `AMB_CATALOG_URL` and `AMB_CATALOG_PUBKEY`.
### Signing-key recovery

The publishing host keeps its Ed25519 key pair in `.runtime/catalog/signing.json`, with directory mode `0700` and file mode `0600`. `.runtime/` and the host-local `catalog.lock.json` are Git-ignored. The publishing process reads `privateKey` into `AMB_CATALOG_PRIVATE_KEY`; never print it or put its value in shell history.

age encrypts the key backup; it does not replace catalog signatures. The current setup uses Modelflare's existing age recipients and backup storage, under the configured backup destination's `anymodelbot/catalog-signing/` prefix. `.runtime/catalog/backup-receipt.json` records object locations, sizes and SHA-256 hashes. Uploads are checked against remote object sizes.

To recover, download the matching `.json.age`, decrypt it using the age identity kept offline, and restore the signing file with mode `0600`. Derive its public key and compare it with `CATALOG_PUBLIC_KEY` in `src/botkit/config.ts` before publishing. Version 0.1.23 replaces the catalog public key because the original private key was lost; older clients need to update before loading the new catalog.

## Building bots with Claude

`.claude/skills/amb-bot-dev/` is the bot dev skill, which turns these rules into steps for Claude. Tell Claude what to build; it scaffolds from the template and works until `check` passes. A future batch pipeline would just be one more author, and its output would pass the same checks.

## APIs

All under `/amb/api`. Errors only return a `code`; the text lives in the UI dictionary at `botapp.errors.*`.

| API | Purpose |
| --- | --- |
| `GET /catalog` | List the catalog |
| `POST /catalog/sync` | Sync now |
| `POST /catalog/dev`, `DELETE /catalog/dev/:id` | Register or remove a local folder (loopback only) |
| `GET /catalog/:id` | One entry |
| `POST /catalog/:id/preview` | Prepare the UI and return its URL, without an instance |
| `GET /catalog/:id/file?path=` | Read sample data when there's no instance |
| `POST /catalog/:id/install` | Create the instance |
| `GET /bots/:id/app` | Instance source, version, whether an update exists |
| `POST /bots/:id/app/update` | Update |
| `GET /bots/:id/app/file?path=` | Read a file under `app/` |
| `GET /bots/:id/app/image?path=` | Read an image under `app/` as a data URL |
| `GET /bots/:id/app/list` | List files under `app/` (used by evals) |
| `GET /bots/:id/app/download?path=` | Read a file under `app/`; add `download=1` to force download |
| `GET /bots/:id/app/preview?path=` | Read a preview descriptor for a file under `app/` |
| `POST /bots/:id/app/open` | Desktop app: open a file under `app/` or show it in its folder |
| `POST /bots/:id/app/inbox` | Put a file in `app/inbox/` |
| `GET /bots/:id/app/watch` | SSE: file changes under `app/` |

Static files are under `/amb/botapp/`: `kit/` (kit and design system), `b/<sha256>/` (UI bundles), `d/<id>/` (dev folders), `thumb/<sha256>` (thumbnails). This path needs no token, because sandboxed pages can't send cookies, and it holds no user data.
