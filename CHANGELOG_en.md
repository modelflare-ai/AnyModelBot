# Changelog

[简体中文](./CHANGELOG.md) | English | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | [Español](./CHANGELOG_es.md) | [Português (Brasil)](./CHANGELOG_pt.md)

This covers changes you'll notice in the app. For older versions, see the [GitHub releases](https://github.com/modelflare-ai/AnyModelBot/releases).

## 0.1.35 - 2026-11-14

### New

- **Cleaner sidebar and icons:** standard actions now use Heroicons. Collapse, search and new stay at the top, while Scheduled becomes a labeled navigation item. The update button beside your account downloads updates and restarts to install when ready.
- **Balance directly in Settings:** Settings → Models shows your account balance, Bot credits and remaining percentage, with refresh and top-up actions. The sidebar balance ring and hover card are removed.

### Improvements and fixes

- **Stable resource previews:** website entry and resource selection use shared controls. Switching right-panel tabs preserves its width, including manual adjustments. Fixed the sidebar expand button becoming unclickable after collapse.
- **Clearer error recovery:** quota reservation failures are classified as low balance, including errors with prefixed messages. Recovery actions match the account provider, and sidebar previews no longer expose raw error responses.
- **Clearer computer permissions:** one missing permission uses a singular heading, and reopening the app becomes the main action when required. Chat and form drafts and pending requests are preserved before reopening.
- **Rule management fixes:** toggling a rule or changing its destination keeps undo available. Owners can manage rules across conversations; group members remain isolated by identity. Frequency counts cover the next 30 days, with lower-frequency suggestions of every three hours or daily.
- **Consistent onboarding and copy:** template seed memory and automatic reviews no longer complete the remember-you step. Template samples, undo messages, rule forms and activation guidance are aligned across seven languages.

## 0.1.34 - 2026-11-14

### New

- **Early startup diagnostics:** the desktop app writes a separate `startup-<time>-<PID>.log` before requesting the single-instance lock, recording the OS version, actual data directory, lock result and startup stages. If the data directory is unwritable, it tries the system temporary directory.
- **Startup troubleshooting switch:** launch with `--diagnose-startup` to show the diagnostic log location when the single-instance lock is not acquired, helping investigate exits without a window.

### Improvements and fixes

- If a second launch arrives before the local interface service is ready, its window activation is queued until startup finishes, avoiding premature window creation.
- Each launch has its own log; the primary instance retains the latest twenty. A secondary launch does not rotate the running app’s ordinary `app.log`.
- This improves diagnosis of [#71](https://github.com/modelflare-ai/AnyModelBot/issues/71); the immediate-exit cause on Win11 Insider Build 26300 is not yet confirmed. If `ELECTRON_RUN_AS_NODE` selects Node mode, application code never runs, so that variable still needs checking first. The default Windows log directory is `%APPDATA%\anymodel bot\data\logs`, with a space in the name.

## 0.1.33 - 2026-11-14

### New

- **Scheduled rules in one place:** the new Scheduled page lists rules across all bots and highlights those needing attention. Chat cards, Tasks and Scheduled share on/off controls. Create rules before the first conversation, keep them off, and undo chat-created changes. An undone creation can be restored for ten minutes.
- **Catch-up runs and group summaries:** calendar rules can catch up once within a grace period of up to twelve hours, with the original due time shown. Interval rules do not catch up. Monthly schedules, the next three runs, time zones and cost estimates are now visible. Group summaries use a chosen in-app group; a late summary keeps its original date.
- **Ten bot templates:** choose a role for writing, work or learning, preview its persona, memory and rules, and compare suitable models before creating it. Template rules start off and ask for a destination and source group when needed.
- **Resources in the right panel:** open files and websites from conversations, groups and bot workspaces without leaving the chat. Preview Markdown, text and code, PDFs, images and HTML, with download and external-opening options.
- **Workspaces that fit the side panel:** official bots collapse project navigation at narrower widths. Expand a workspace and return to chat while keeping the current editing state.
- **Continue after macOS permission setup:** one permission card replaces repeated errors. The app checks automatically and, when eligible, resumes unfinished steps in the original conversation while preserving drafts. A newer message or a wait over thirty minutes requires Continue.

### Improvements and fixes

- Improved Modelflare sign-in return handling, account names and avatars, and first-use guidance. Connected-app lists, search and error messages are clearer.
- Improved Film Studio canvas layout and US Stock Research chart-data handling; PPT Master and Company Research also adopt the updated workspace.
- Rule results identify their source and follow the reply-notification preference. An optional setting prevents sleep shortly before a rule is due while plugged in; it cannot wake an already sleeping or closed computer.

## 0.1.32 - 2026-11-11

### New

- **Spanish and Portuguese (Brazil):** Two new interface languages. Pick one in Settings → General → Language; if your system language is Spanish or Portuguese, the app uses it automatically. The interface, the tray menu, system messages from bots and What's new are all translated.
- **Official bots in Spanish and Portuguese:** PPT Master, Film Studio, Company Research and US Stock Research have Spanish and Portuguese names, descriptions, starters, workspace interfaces and samples.

### Improvements and fixes

- US Stock Research charts read numbers that use a comma as the decimal mark (such as 12,5%), and changes in the key figures follow the number format of the interface language.

## 0.1.31 - 2026-11-11

### New

- **Connect apps:** The avatar menu in the bottom-left corner has a new Connect apps item. Connect the apps you use and your bots can read and write their content. Connect once and every bot can use it by default; you can narrow it per bot and per tool under Apps in a bot's settings.
- **Built-in apps:** GitHub, Notion, Linear, Atlassian (Jira and Confluence) and Canva connect in a step or two.
- **Built-in apps for China:** Feishu (read and write cloud docs, read group chat messages), Tencent Docs, DingTalk, Amap and Yuque. The Chinese interface lists them first.
- **Custom connectors (MCP):** Add them under My MCP on the Apps page. Paste a URL, mcpServers JSON, a `claude mcp add` command or a local start command and it is recognized; you can also fill in the form or edit JSON. Remote servers and local commands both work, with sign-in, headers, query parameters or a dedicated URL for authentication, up to 20 connectors.
- **Asks before changing your data:** Read-only tools run right away. Writes ask you in the chat first by default, and you can choose Always allow this tool, which you can revoke later in the bot's settings. Deletes and anything sent to other people always ask. Read-only bots can't write.
- **Fix a connection from the chat:** When a task needs an app that isn't connected, or a sign-in has expired or a key stopped working, a card appears in the chat. Click it to connect or fix it, and the bot carries on with the task.
- **Right panel:** The info panel is now a row of tabs: Overview, Tasks and Memory. Official bots add a Workspace tab for their own interface, and the main area is always the chat.
- **Sidebar sections:** Put bots, group chats and official bots into sections you create. Sections can be added, renamed, deleted and dragged to reorder.
- **Official bots have their own look:** PPT Master, Film Studio, Company Research and US Stock Research each get their own avatar and a new cover. Bots whose avatar you haven't changed switch automatically.

### Improvements and fixes

- Settings › Connections is now Chat channels and only holds chat app accounts. Your existing Notion accounts moved to Connect apps and don't need to be authorized again.
- Existing Feishu message accounts also moved to the Feishu card under Connect apps without re-authorizing; authorize again to read and write cloud docs too.
- Creating and updating Notion pages now asks first, following the rule above.
- App tokens, keys and dedicated URLs are stored in a separate file, not in the database, and are masked in the interface and logs.
- macOS no longer shows a keychain prompt: the Modelflare sign-in is protected by file permissions, like the other credentials.
- When signing in or connecting to Modelflare fails, the message names the actual network reason.
- You can drag the window from empty space on the Discover page.
- The guide in a new group chat is now three short tips and two or three starters; click a starter to put it in the input box.
- Model settings on the New bot page look like the Model group in bot settings, and the Create button is as wide as the form.
- The note under Feedback in the avatar menu is gone.

## 0.1.30 - 2026-11-10

### New

- **Bot credits:** Accounts with Modelflare Bot credits see a ring and the percentage left in the bottom-left corner. Click it to see your Bot credits, account balance and the Top up link. Bot credits are usable only in AnyModelBot, and requests from keys the app issues use them first. The numbers refresh when you open the card and after each message is handled. Accounts without Bot credits see the same corner as before.
- **$1 in Bot credits for new accounts:** The sign-in page and the API key page now mention the sign-up credit. Modelflare subscriptions add Bot credits worth 10% of the plan, as the credit card also explains.
- **What's new:** After an update, the first launch shows what changed, and you can scroll down through every version. Clicking the new-version notice in the sidebar shows the new version's notes first, so you can decide before you download or restart. The changelog is always available in Settings → About.
- **Official bots as desktop workspaces:** Company Research, PPT Master, Film Studio and US Stock Research show your work in a list on the left and the content on the right. New starts a short guided form. The top bar switches between Workspace and Chat, where you see the full conversation. US Stock Research charts the key numbers, Film Studio has a storyboard with picture, video and audio lanes, and PPT Master lets you page through previews.
- **Model choice in bots with their own UI:** The input box works like a regular chat, with the model picker, the + menu and slash commands.
- **Recent chats in search:** Before you type, the search dialog lists recent chats grouped as Today, Yesterday, Previous 7 days and Earlier.

### Improvements and fixes

- WeChat QR sign-in: when it asks for the code shown on your phone, the code is checked right away instead of after about half a minute. A wrong code says so, and too many wrong codes bring up a new QR code.
- The account menu is as wide as the account area, and hovering darkens only the avatar. The settings navigation fills the sidebar, with the account area pinned to the bottom.
- Starters in bots with their own UI are a row of single-line chips; hover to read a long one in full.

## 0.1.29 - 2026-11-09

### New

- **Automatic update downloads, enabled by default:** Installed desktop apps download new versions in the background, then offer Restart and update in the sidebar and Settings → About. Turn automatic downloads off in Settings → General to download manually.
- Installation requires your click and waits until you have no active chats or background tasks. Normal quits do not install updates automatically.
- Users on 0.1.28 or earlier must manually install this version once before using in-app updates. Supported on macOS, Windows and Linux AppImage; Docker and source deployments still update manually.
- **Back to the app after signing in:** After you approve in the browser, the page waits until the app is actually connected before it says you're signed in, then takes you back to AnyModelBot. If something fails, it tells you why. The API key page also lets you sign in with a Modelflare account instead.
- **A model picked for your first sign-in:** If you have no default model yet, the app picks a low-cost model that supports tools (DeepSeek first), so the trial credit covers a few typical tasks. If none fits, it explains why and lets you choose.
- **macOS Computer Use permissions asked only when needed:** The first time a bot needs to click, type or look at the screen without Accessibility or Screen Recording permission, that turn stops and the chat says which permission is missing, with buttons to request it, open the matching settings page and check again. If the app has to be reopened, unsent drafts are kept.
- **Discover covers:** Official bots now have illustrated cover scenes that follow the light or dark theme, and featured bots show as large cards.

### Improvements and fixes

- Clearer error messages: low balance, expired credentials, unavailable models, rate limits and network failures each get their own explanation and a matching action, such as Top up or switching models. The raw error sits under Error details and can be copied with secrets removed. The same error no longer pops up twice, the sidebar shows only "Failed: reason", and Send again warns that the whole task runs from the start. The company research bot folds task errors the same way.
- The account area in the bottom left always shows your balance and a Top up link, and low balance is flagged there instead of in a separate in-app notice. Its menu has feedback, check for updates and sign out; signing out while tasks are running asks first. With your own API key, you can sign in to Modelflare from here and keep your keys and settings.
- Getting started checklist: "Connect your usual chat app" lets you pick a channel and opens its settings, and only counts once it is actually connected. "Say hello" needs a real reply. After you say "remember …", the checklist updates within seconds. Guidance no longer pops up while you have a draft or a task is running, and the checklist folds away once everything is done.
- After you replace a key or switch model source, the app reminds you to check your existing bots' models. It stays quiet on first setup.
- Saving bot settings several times in a row shows a single "Saved". New bots keep model settings collapsed with the inherited default shown, and no longer silently pick the first model in the list. Creating a multi-bot group explains how it works, with example prompts based on its members.
- Clicking Discover while searching takes you back to Discover.
- Bots with their own interface (company research, PPT Master, film studio, US stock research) now use the same composer as regular chats. Starters are a row of cards, so long ones are no longer cut off. The latest reply is rendered as Markdown, long replies can be expanded, and you can open the full conversation.
- A cleaner interface: fewer divider lines and borders, filled input fields, and fixed Needs you and Discover rows in the sidebar, with a blue dot instead of a count (the count is still in the tooltip and for screen readers).
- Cleaner bot avatar edges: the light fringe around avatars on dark backgrounds is gone, and small avatars now use images pre-scaled for their size, so edges look smoother.
- macOS installers are checked for a Developer ID signature and Apple notarization before release, and are not published if either check fails.

## 0.1.28 - 2026-11-08

### New

- **Official bots ship with the app:** Company Research, PPT Master, Film Studio and US Stock Research include their UIs, samples, personas and skills in the installer. First preview and installation need no bot package downloads. Model calls and online research still need a network connection.

### Improvements and fixes

- Fixed clipped catalog bot content and missing scrolling. The input box no longer covers content, and upgrades preserve existing projects and data.
- Release builds reuse Electron's bundled checksum data to reduce network timeouts when fetching checksum files, while retaining full hash verification.
- GitHub macOS builds for both Intel and Apple silicon now fall back to TCP for Apple services to work around known HTTP/3 connection drops. Signing, timestamps and notarization remain required.

## 0.1.27 - 2026-11-08

### New

- **Official bots ship with the app:** Company Research, PPT Master, Film Studio and US Stock Research include their UIs, samples, personas and skills in the installer. First preview and installation need no bot package downloads. Model calls and online research still need a network connection.

### Improvements and fixes

- Fixed clipped catalog bot content and missing scrolling. The input box no longer covers content, and upgrades preserve existing projects and data.
- Release builds reuse Electron's bundled checksum data to reduce network timeouts when fetching checksum files, while retaining full hash verification.
- GitHub Intel Mac builds now fall back to TCP for Apple services to work around known HTTP/3 connection drops. Signing, timestamps and notarization remain required.

## 0.1.26 - 2026-11-08

### New

- **Official bots ship with the app:** Company Research, PPT Master, Film Studio and US Stock Research include their UIs, samples, personas and skills in the installer. First preview and installation need no bot package downloads. Model calls and online research still need a network connection.

### Improvements and fixes

- Fixed clipped catalog bot content and missing scrolling. The input box no longer covers content, and upgrades preserve existing projects and data.
- Release builds reuse Electron's bundled checksum data to reduce network timeouts when fetching checksum files, while retaining full hash verification.

## 0.1.25 - 2026-11-08

### New

- **Official bots ship with the app:** Company Research, PPT Master, Film Studio and US Stock Research include their UIs, samples, personas and skills in the installer. First preview and installation no longer download bot packages; updates ship with app releases. Model calls and online research still need a network connection.

### Improvements and fixes

- Fixed catalog bot content being clipped to a short strip at the top, leaving a large blank area with no scrolling. Content now fills the available space, and the input box no longer covers it.
- App upgrades preserve existing bot projects and data, and switch to the updated UI only after it is ready, avoiding a blank view.

## 0.1.24 - 2026-11-07

### New

- **Import skills from ZIP:** In Bot settings → Skills, import a ZIP containing `SKILL.md`, preview its name and description, then add it. View, enable, disable or delete skills, and confirm replacement when importing the same name again. Scripts, references and assets are preserved.
- **Search chat history:** Search messages stored on this device from the sidebar, filter by bot, conversation, channel or date, and jump to the original message. `Ctrl/Cmd+Shift+F` opens global search; `Ctrl/Cmd+F` searches the current chat, including history that has not loaded yet. Search makes no model calls.
- Skills are managed separately for each bot and changes apply when the bot is idle. Replacement preserves the enabled state, deletion keeps workspace output, and imported packages cannot overwrite built-in or catalog bot skills.

## 0.1.23 - 2026-11-06

### New

- Added the Film Studio catalog bot for short videos, episodic dramas, asset libraries, storyboards, canvases, narration, subtitles and local rendering. Creative rules and the composition engine are ported from PRINTFILM (MIT).
- Catalog bots can preview audio/video and keep media takes. Durable generation IDs let interrupted work retrieve the original task without automatic resubmission.
- Restored bot downloads in Discover. Update to 0.1.23 to use the renewed catalog signing key.

## 0.1.22 - 2026-11-04

### New

- **Use your own official API keys:** You no longer need an account. On first launch, click Use your own API key, or go to Settings → Models and enter a key from OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax or Mistral. Model requests go straight to the provider, the provider bills you, and the key stays on this device. Image and video generation is still only available through Modelflare.
- **Keenable for web search:** Choose it in Settings → Network & access and enter a key.

### Improvements and fixes

- The Modelflare tab in Settings is now called Models, and you can sign in to Modelflare there if you aren't signed in.
- Company Research, US Stock Research and PPT Master now support Japanese, Korean and Russian.

### Privacy

- With only official API keys and no sign-in, the app doesn't read Modelflare's account data or price catalog. The built-in gateway reads the public model catalog from models.dev, and that request carries no keys or conversation content.

## 0.1.21 - 2026-11-03

### New

- **Easier channel setup:** Connections in Settings have been rebuilt. Each app shows how to connect, so you just follow the steps to scan a code or enter a token. If it's still waiting for a first message to finish linking, it tells you. You can also add more accounts for the same app.

### Improvements and fixes

- **Clearer bot deletion:** The confirmation now says which bot will answer that bot's chat channels afterward. If it's your last bot, it warns you that those messages won't get a reply.
- **Removing Discover bots:** A checkbox in the same confirmation lets you keep the bot's data.
- **Cleaner look:** The window background no longer has a glow, actions use neutral colors, and font sizes no longer use half pixels, so text is sharper on Windows.
- **Balance alert:** When your balance runs low, the sidebar just says so. Select your avatar to see the amount.
- **Frosted glass follows your system:** The setting is gone, and the app now follows your system's reduce transparency setting.
- While you create a bot, the sidebar shows its avatar and name as you type, and it no longer flashes to another bot when it's done.
- Dropdown menus now follow the page as it scrolls, and the Discover layout has been refined.

## 0.1.20 - 2026-11-03

### New

- **Discover:** The sidebar now has Discover, with ready-made bots that each have their own view. Opening one shows a sample, and it's only installed when you send your first message. Remove it whenever you like.
- **Company Research:** Give it a company name and it researches financials, news, industry and business, then writes a report with source links for key facts. It can export a PDF if Python is installed.
- **US Stock Research:** Writes research reports from SEC filings, with every number traceable.
- **PPT Master:** Turns documents or topics into editable PPTX decks, and can also make templates or edit decks you have. It needs Python.
- **12 expert avatars:** The avatar picker now has characters for 12 fields, including law, health, finance, coding and design.

### Privacy

- At startup and every 6 hours, the app reads the bot catalog from anymodel.bot, and it downloads a bot's package when you open or use it. These requests only download; your data isn't uploaded. To turn the catalog off, set the environment variable `AMB_CATALOG=off`.

## 0.1.19 - 2026-11-03

### Important changes

- **Sign-in is now required:** Pasting an API key is no longer supported; everyone signs in with a Modelflare account. After you update, any key you entered earlier is removed from this device and the app asks you to sign in. Your bots and conversations keep working once you do.
- **Sign-in now works in Docker and remote deployments:** Sign in from a browser on any device, then paste the link from the address bar back into the app. During command-line setup, enter `remote`.

### New

- **Reasoning effort:** Choose Auto, Low, Medium or High. Higher settings think harder and reply more slowly. With Auto the model decides, and models that can't adjust aren't affected.
- **More detail when testing a model:** Troubleshooting now shows results for the built-in gateway and the direct endpoint separately, with status code, time taken and the original error.

### Improvements and fixes

- If the model list endpoint doesn't respond, the app stops waiting after 30 seconds, so "Test model" no longer spins forever.
- Updated the website's partner page, home page and download page.

## 0.1.18 - 2026-11-03

### New

- This release includes full five-language support, manual API-domain selection and latency checks, update reminders, local proxy diagnostics, and the website, download and partner-page updates. See the 0.1.17 section below for feature details.

### Fixed

- Fixed a documentation check that misidentified roadmap content in Windows checkouts using CRLF line endings. Regression tests now cover LF, CRLF and CR. Application behavior is unchanged by this fix.

## 0.1.17 - 2026-11-03

### New

- **Five languages:** Japanese, Korean and Russian join Simplified Chinese and English across the app, tray, system messages, authorization prompts, website and documentation. Switch languages during onboarding, in Settings or from the command palette.
- **API domains and latency checks:** Manually choose `modelflare.dev`, `origin.modelflare.dev` or `cf.modelflare.dev` and compare response times from the device running the app. Checks send no API key, make no model calls and never switch domains automatically.
- **Update reminders:** The sidebar and About page show available updates. Open the download page or dismiss the reminder for that version.
- **Website partner page:** Learn about partnerships and fill in an application. Without a submission endpoint, the form clearly uses email instead of claiming the application was sent.

### Improved and fixed

- Translation files are organized by module. Release checks validate missing content, placeholders, plurals and documentation links. Russian plurals, localized amounts and dates, Japanese and Korean input methods, and mobile line breaks are improved.
- Feishu and Notion authorization errors follow the current language. Refused connections to a local proxy now include actionable guidance while retaining the original error.
- Refined the website's sky effects, download page and mobile layouts, with localized sharing images, search-engine language annotations and 404 pages.

## 0.1.16 - 2026-11-02

### New

- **Group chats:** With two or more bots, click ＋ in the sidebar to create a group chat and talk to several bots at once. Whoever you @ answers; with no @, the bot that answered last carries on. Bots can also @ another member to hand off. Each bot keeps its own model, workspace and memory, and costs are tracked per bot.

### Changed

- **Balance stays out of the way:** The bottom-left corner now shows only your avatar, name and the settings button. Click the avatar to see your balance and top up. You still get a sidebar reminder when your balance drops below the alert level.

## 0.1.15 - 2026-11-02

### New

- **Accounts shared by all bots:** Add chat and Notion accounts once in Settings › Connections, and every bot can use them. Each service can have several accounts, each with its own alias.
- **Switch bots from a chat:** Send `/bot` in a chat app to see your bots, and `/bot name` once to switch. That chat stays with the new bot, so you don't repeat it on every message. Each bot also knows about the others, so it can answer when you ask.
- **Telegram, Slack and Discord:** Paste a token to connect. No public address needed, and images and files work both ways.
- **Notion:** Connect with one-click authorization or a token. Bots can search, read, create and edit pages, and query databases. They can't delete pages.
- **Read Feishu messages:** Authorize with a QR code, then ask any bot to "check my second Feishu". It reads chats and searches messages as you, read-only.
- **Add Feishu by scanning:** When adding a Feishu chat account, scan a QR code to create the app instead of entering an App ID and Secret.

### Improved

- **Web search no longer needs a DeepSeek key:** It's free by default, and you can switch to Tavily, Exa, Bocha, Zhipu or your own SearXNG.
- **Characters are separate from roles:** An avatar only sets a bot's looks, and picking a template doesn't change it.

### Changed

- Chat channel setup moved from each bot's info panel to Settings › Connections. Existing accounts move over automatically with no new sign-in, and the same bot still answers by default.
- Owners and allow lists now belong to the account, so anyone allowed on it can talk to any bot. Deleting a bot no longer affects accounts.
