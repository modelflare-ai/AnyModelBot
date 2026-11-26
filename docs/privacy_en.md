# Data and privacy

[简体中文](./privacy.md) | [繁體中文（台灣）](./privacy_zh-TW.md) | English | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | [Español](./privacy_es.md) | [Português (Brasil)](./privacy_pt.md) | [Türkçe](./privacy_tr.md)

**In one sentence:** conversations, memory, files and keys are stored on your device; whatever you send to a model goes to the model provider you chose, directly with your own official API key and otherwise through Modelflare. We do not claim your data is beyond all risk — anything sent to a model leaves your device.

This document explains what AnyModelBot stores where, what leaves your device, and how to delete it. Questions: [support@anymodel.bot](mailto:support@anymodel.bot).

## Data directory

| How you run it | Data directory |
| :--- | :--- |
| Desktop · Windows | `%APPDATA%\anymodel bot\data` |
| Desktop · macOS | `~/Library/Application Support/anymodel bot/data` |
| Desktop · Linux | `~/.config/anymodel bot/data` |
| Command line `npm start` | `./data` (change with `AMB_DATA_DIR`) |
| Docker | `/data` in the container (mounted as the `amb-data` volume in the README example) |

## Data inventory

| Data | Where it lives (inside the data directory) | Does it leave the device? | Where it goes |
| :--- | :--- | :--- | :--- |
| Conversations and sessions | `anymodel.db` (SQLite) | The part a reply needs | Sent as model context through Modelflare to the provider you chose |
| Imported skills | `skills/<bot ID>/`; enabled copies in `dsh/<bot ID>/skills/` | Names, descriptions and content loaded during use do | Context for the selected model; import uploads only to your AnyModelBot instance and does not contact GitHub |
| Chat search index | `message_search` and its full-text index in `anymodel.db` | No | Searches saved messages inside the instance without model calls |
| Memory | `memory/` (Markdown: `bots/`, `groups/`; About me: `about-me.json`, with 30 days of change history; `team/` is the team memory from before the upgrade, moved into About me and no longer read) | When it is used | Included as context in model requests; anything that looks like a secret is filtered before it is written, ID and bank card numbers are never saved, and addresses, phone numbers and emails go into About me only after you confirm |
| Bot workspace files | `workspaces/<bot>/` (including received files in `inbox/` and generated images and video in `media/`) | When a bot reads them and sends them to a model | Same as above |
| Message attachments | `attachments/` (copies of images you paste and of images and text files you drag into a chat, stored under random names; images are kept without EXIF and other metadata). Unsent copies are kept for up to 24 hours and sent ones for 30 days, then deleted | When you send the message | The images and the full text of the files go with that message in the model request to the provider you chose; deleting the local copy does not recall what was already sent |
| Modelflare sign-in credential | `modelflare-account.json` (mode 600) | Only to modelflare.dev when refreshing tokens | Modelflare |
| API key | The gateway's isolated config in `magpie/config/` | As authentication on every model request to Modelflare | Modelflare |
| Official API key (if you add one) | The gateway's isolated config in `magpie/config/` | As authentication on every model request to that provider | That model provider |
| WeChat sign-in state and sync cursor | Inside the data directory (`weixin/` and others) | When talking to the WeChat iLink API | Tencent WeChat |
| App ID / Secret of Feishu chat accounts | `anymodel.db` | When opening the long connection to the Feishu Open Platform | Feishu |
| Telegram, Slack and Discord tokens | `anymodel.db` | When talking to that platform | The platform you connected |
| Allowlist and access requests | `anymodel.db`: who may use which channel account, and the first message a stranger sent (truncated, so you can tell who it is) | No | — |
| Replies waiting to be sent | `anymodel.db` outbox: unsent message content and the reason, including WeChat messages held until the person writes again (kept up to 7 days; sent ones are deleted after 7 days, undeliverable ones after 30) | When they are sent | WeChat / Feishu |
| Background tasks and rules | `anymodel.db` (tasks, rules and run logs, kept 30 days); task folders in `workspaces/<bot>/tasks/`, deleted after 30 days unused (you are told first in Needs you); their session files in `dsh/<bot>/sessions/`, deleted with the task | While they run | As for chats: context in model requests, sent through Modelflare to the provider you chose |
| Settings | `config.json` | No | — |
| Logs | `logs/app.log` (rotated by size) | Not by default; "Copy diagnostics" is something you copy by hand, with keys replaced by `***`. If you tick "Include runtime status and recent logs" under Report a problem in Requests & Feedback and send, the last 120 lines (keys replaced) go with that submission | Your private Modelflare ticket (only when you send) |
| Credentials for connected apps (only if you connect them): sign-in tokens, pasted tokens and keys, dedicated URLs, and the headers / query parameters / environment variables of custom MCP connectors | `app-secrets.json` (permission 600, outside the database); masked in logs, diagnostics and the interface | Sent to that service as authentication each time a bot reads or writes; environment variables of a local command only go to the local program you added | The apps you connect (Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva), or the custom MCP servers you add |
| Names, addresses, status and tool lists of connections | `anymodel.db` (dedicated URLs and addresses that contain a key are stored masked) | No | — |
| Content a bot reads from connected apps (docs, messages, issues…) | Not stored separately; once in a chat it's stored with that chat | Yes | Sent as context in model requests, through Modelflare to the provider you chose |
| Screenshots (computer use) | Not kept long-term | Yes | Sent as part of the model request through Modelflare to a vision-capable model; never forwarded to WeChat or Feishu chats unless you ask for them as files |

## Local console access control

- The console listens on `127.0.0.1:3600` by default and cannot be reached from your network or the internet.
- The desktop app generates a random access token on every launch, so other local programs cannot call the management API directly.
- The console API always requires an access token, on the loopback address too. The desktop app keeps its token in memory only; the command-line version and Docker generate one when none is configured and keep it in `ui-token` in the data directory (Docker: `docker exec amb cat /data/ui-token`). Started from a terminal, the command-line version prints a link with the token once.
- Do not expose port 3600 directly to the internet. For remote access, put it behind a VPN or an authenticating reverse proxy you control.

## Signing in to Modelflare

- Sign-in uses the OIDC authorization code flow with PKCE (RFC 7636), as a native app per RFC 8252: AnyModelBot is a public client with no client secret, and the authorization result is delivered to a temporary loopback port.
- You sign in on modelflare.dev; AnyModelBot never sees your Modelflare password.
- Revoke this device at any time under "Authorized apps" on your Modelflare profile page. "Sign out" in the app also revokes the authorization and deletes the keys issued for this device and its bots.

## Model requests and Modelflare

- Model requests go from the bundled magpie gateway to Modelflare, which forwards them to the provider you chose.
- A request contains what the model needs to answer: the prompt, conversation context, memory in use, file contents, tool results and, with computer use, screenshots.
- Requests carry an `X-Modelflare-Skill: anymodel-bot/<version>` header so Modelflare can identify the source; Modelflare links opened from the app carry `utm_source=anymodelbot`. When the app opens the top-up page, the URL carries the account identifier from the sign-in ID token after `#` (`#amb_account=…`, not a secret) so the Modelflare page can check that the browser is signed in to the same account; what follows `#` is not sent to servers, CDNs or analytics scripts. The "Key configuration changed" notice compares an HMAC of the key computed locally with a random salt; the key and its digest are neither stored for this nor uploaded.
- Modelflare keeps request logs; see the [Modelflare Trust Center](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) for what is kept and for how long. How each model provider handles data is governed by its own terms.

## Using your own official API keys

- After you enter an official key from OpenAI, Anthropic or another provider on the welcome screen or in Settings → Models, the built-in gateway sends that provider's model requests straight to them. They don't pass through Modelflare and don't carry the `X-Modelflare-Skill` header. That provider's own terms govern how the content is kept.
- Provider addresses are fixed in the app and can't be changed from the interface or its API, so your key isn't sent anywhere else. Keys live only in the gateway's isolated config (mode 600), never in logs or command-line arguments, and the interface shows only the last 4 characters.
- With only official keys and no sign-in, the app doesn't read Modelflare's account data or price catalog. When you enter a key, the app uses it to read that provider's model list once to check it, then hourly to keep the list current.
- The built-in gateway reads the public model catalog from `models.dev` (context lengths, reference prices). This request only downloads, and carries no keys or conversation content.
- Image and video generation is only available through Modelflare.

## Telemetry

- Telemetry in the bundled computer-use driver (Cua Driver) is switched off with `CUA_TELEMETRY_ENABLED=0` and `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- The bundled magpie gateway runs with auto-update and account discovery off, and does not read credentials of other AI tools on your computer.
- AnyModelBot's own code (`src`, `electron`, `ui`, `scripts`, `dsh-runtime/plugins`) contains no analytics or telemetry reporting: a search for telemetry, analytics, sentry, posthog and mixpanel only matches the two Cua environment variables above.
- Bundled third-party components behave as their own documentation describes; we make no guarantees for them here.

## Other network requests the app makes

Besides model requests, the app goes online to:

- Read Modelflare's model catalog, your balance, usage and notifications (your account data, from modelflare.dev).
- When you send from Requests & Feedback (Use cases & ideas, Report a problem, or Business & partnerships): what you wrote, any context or business details you added, the role you chose, where you opened it from, the version and system details, and the error and logs you chose to include (keys replaced by `***`) go to modelflare.dev as a private ticket on your Modelflare account. Replies are emailed to you and appear on Modelflare's tickets page. You can review exactly what will be sent first; conversations and screenshots are never attached. Contact details are not sent by default: only if you open "Open to a follow-up?", tick "I agree to be contacted about this feedback only" and pick your account email or enter an email or WeChat ID, and only for following up on that feedback. Closing the window, signing in or switching accounts asks you again. Drafts stay in the app's data folder on this device (per account, readable only by you, not by bots, cleared after 7 idle days) and are never synced. Without a Modelflare sign-in, or with an external gateway, you can't create in-app tickets; you can send it yourself by email or on GitHub (public) instead, and that copy leaves out contact details and business details. "Contact Modelflare" opens the business contact page without anything you typed.
- Read a model's request format from docs.modelflare.dev when generating images or video.
- WeChat channel: talk to `ilinkai.weixin.qq.com` and download images and files you send from the WeChat CDN.
- Feishu channel: keep a long connection to the Feishu Open Platform.
- Telegram, Slack and Discord channels: once connected, talk to `api.telegram.org`, `slack.com`, `discord.com` and their file hosts to send and receive messages and the files you send.
- On Windows, with agent mode on and no working PowerShell 7 on the system, download PowerShell 7 from Microsoft's official release location (turn this off with `AMB_PWSH_AUTO_INSTALL=0`; see the [development guide](./development_en.md)).
- Installed desktop apps check GitHub for updates after startup and every 6 hours, and download update files in the background by default. You can turn automatic downloads off in Settings → General. Requests contain no account credentials or chat content. Installation requires you to click Restart and update, with no tasks running.
- When you open What's new for a version you haven't installed yet, the app reads that version's changelog from GitHub (`raw.githubusercontent.com`). It only does so when you open it, with no account credentials or chat content. The changelog for installed versions ships with the app and needs no network.
- Only when you explicitly set `AMB_CATALOG_URL` to use a remote bot catalog does the app fetch its list and download packages on demand, verifying signatures and hashes without uploading your data. By default, the official bot catalog, UIs, sample data and skills ship with the app; opening and installing them makes no such network requests.

## Computer use and screenshots

- Reading the screen takes screenshots, which are sent as part of the model request to a vision-capable model.
- By default, computer-use actions run automatically. In Bot settings → Computer use you can switch to "ask me before actions that change the screen"; reading the screen stays automatic.
- Bots with the read-only preset only get read tools.

## Channels

- Messages you exchange with a bot on WeChat, Feishu, Telegram, Slack or Discord pass through those platforms' servers and are subject to their privacy policies.
- By default only the owner and people you allow can talk to a bot; messages from anyone else are not given to a model, only recorded as access requests (see the [developer guide](./development_en.md#who-can-use-a-bot)).

## Deleting your data

1. Quit AnyModelBot (tray menu → Quit).
2. Delete the data directory from the table above. Docker: `docker rm -f amb && docker volume rm amb-data`.
3. Revoke AnyModelBot under "Authorized apps" on your Modelflare profile page.
4. If needed, disable the apps you created on the Feishu Open Platform (including any created by scanning), unbind the bot in WeChat, delete the bots you created on Telegram (@BotFather), Slack and Discord, and in each app's own settings (Notion, Feishu, GitHub and so on) revoke AnyModelBot's authorization and delete any tokens and keys you created.
