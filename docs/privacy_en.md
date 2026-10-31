# Data and privacy

[简体中文](./privacy.md) | English

**In one sentence:** conversations, memory, files and keys are stored on your device; whatever you send to a model goes through Modelflare to the model provider you chose. We do not claim your data is beyond all risk — anything sent to a model leaves your device.

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
| Memory | `memory/` (Markdown: `bots/`, `groups/`, `team/`) | When it is used | Included as context in model requests; anything that looks like a secret is filtered before it is written |
| Bot workspace files | `workspaces/<bot>/` (including received files in `inbox/` and generated images and video in `media/`) | When a bot reads them and sends them to a model | Same as above |
| Modelflare sign-in credential | `modelflare-account.json` (mode 600; encrypted with the system keychain in the desktop app) | Only to modelflare.dev when refreshing tokens | Modelflare |
| API key | The gateway's isolated config in `magpie/config/` | As authentication on every model request to Modelflare | Modelflare |
| WeChat sign-in state and sync cursor | Inside the data directory (`weixin/` and others) | When talking to the WeChat iLink API | Tencent WeChat |
| Feishu App ID / Secret | Configuration inside the data directory | When opening the long connection to the Feishu Open Platform | Feishu |
| Allowlist and access requests | `anymodel.db`: who may use which bot, and the first message a stranger sent (truncated, so you can tell who it is) | No | — |
| Replies waiting to be sent | `anymodel.db` outbox: unsent message content and the reason (sent ones are deleted after 7 days, undeliverable ones after 30) | When they are sent | WeChat / Feishu |
| Settings | `config.json` | No | — |
| Logs | `logs/app.log` (rotated by size) | No; "Copy diagnostics" is something you copy by hand, with keys replaced by `***` | — |
| Screenshots (computer use) | Not kept long-term | Yes | Sent as part of the model request through Modelflare to a vision-capable model; never forwarded to WeChat or Feishu chats unless you ask for them as files |

## Local console access control

- The console listens on `127.0.0.1:3600` by default and cannot be reached from your network or the internet.
- The desktop app generates a random access token on every launch, so other local programs cannot call the management API directly.
- When listening on a non-loopback address (for example `0.0.0.0` in Docker), token access is enforced. The token is in `ui-token` in the data directory (Docker: `docker exec amb cat /data/ui-token`).
- Do not expose port 3600 directly to the internet. For remote access, put it behind a VPN or an authenticating reverse proxy you control.

## Signing in to Modelflare

- Sign-in uses the OIDC authorization code flow with PKCE (RFC 7636), as a native app per RFC 8252: AnyModelBot is a public client with no client secret, and the authorization result is delivered to a temporary loopback port.
- You sign in on modelflare.dev; AnyModelBot never sees your Modelflare password.
- Revoke this device at any time under "Authorized apps" on your Modelflare profile page. "Sign out" in the app also revokes the authorization and deletes the keys issued for this device and its bots.

## Model requests and Modelflare

- Model requests go from the bundled magpie gateway to Modelflare, which forwards them to the provider you chose.
- A request contains what the model needs to answer: the prompt, conversation context, memory in use, file contents, tool results and, with computer use, screenshots.
- Requests carry an `X-Modelflare-Skill: anymodel-bot/<version>` header so Modelflare can identify the source; Modelflare links opened from the app carry `utm_source=anymodelbot`.
- Modelflare keeps request logs; see the [Modelflare Trust Center](https://modelflare.dev/trust) for what is kept and for how long. How each model provider handles data is governed by its own terms.

## Telemetry

- Telemetry in the bundled computer-use driver (Cua Driver) is switched off with `CUA_TELEMETRY_ENABLED=0` and `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- The bundled magpie gateway runs with auto-update and account discovery off, and does not read credentials of other AI tools on your computer.
- AnyModelBot's own code (`src`, `electron`, `ui`, `scripts`, `dsh-runtime/plugins`) contains no analytics or telemetry reporting: a search for telemetry, analytics, sentry, posthog and mixpanel only matches the two Cua environment variables above.
- Bundled third-party components behave as their own documentation describes; we make no guarantees for them here.

## Other network requests the app makes

Besides model requests, the app goes online to:

- Read Modelflare's model catalog, your balance, usage and notifications (your account data, from modelflare.dev).
- Read a model's request format from docs.modelflare.dev when generating images or video.
- WeChat channel: talk to `ilinkai.weixin.qq.com` and download images and files you send from the WeChat CDN.
- Feishu channel: keep a long connection to the Feishu Open Platform.
- On Windows, with agent mode on and no working PowerShell 7 on the system, download PowerShell 7 from Microsoft's official release location (turn this off with `AMB_PWSH_AUTO_INSTALL=0`; see the [development guide](./development_en.md)).

## Computer use and screenshots

- Reading the screen takes screenshots, which are sent as part of the model request to a vision-capable model.
- By default, computer-use actions run automatically. In Bot settings → Computer use you can switch to "ask me before actions that change the screen"; reading the screen stays automatic.
- Bots with the read-only preset only get read tools.

## Channels

- Messages you exchange with a bot on WeChat or Feishu pass through Tencent's or Feishu's servers and are subject to those platforms' privacy policies.
- By default only the owner and people you allow can talk to a bot; messages from anyone else are not given to a model, only recorded as access requests (see the [developer guide](./development_en.md#who-can-use-a-bot)).

## Deleting your data

1. Quit AnyModelBot (tray menu → Quit).
2. Delete the data directory from the table above. Docker: `docker rm -f amb && docker volume rm amb-data`.
3. Revoke AnyModelBot under "Authorized apps" on your Modelflare profile page.
4. If needed, disable the app you created on the Feishu Open Platform and unbind the bot in WeChat.
