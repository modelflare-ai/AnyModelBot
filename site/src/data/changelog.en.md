# Changelog

[简体中文](./CHANGELOG.md) | English | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | [Español](./CHANGELOG_es.md) | [Português (Brasil)](./CHANGELOG_pt.md) | [Türkçe](./CHANGELOG_tr.md)

This covers changes you'll notice in the app. For older versions, see the [GitHub releases](https://github.com/modelflare-ai/AnyModelBot/releases).

## 0.1.48 - 2026-11-25

### New

- **Import skills from this machine:** in the desktop app, skills already installed for other tools on your computer (Claude Code, Codex, Cursor, CodeBuddy and more) can be imported in one go. Six common places such as `~/.claude/skills/` are searched automatically, and Choose folder… picks a skill folder or a project; only folders and file names are listed until you select skills and click Next. The review explains each one: ready to import, already exists, same name with different content (skipped by default, or saved separately) or incompatible with the reason. Importing never runs scripts, and skills with possible private files or invocation limits this app can't keep the same way are not imported. Coming from a bot's settings, imported skills are turned on for that bot by default.
- **My skill library:** the avatar menu has a new My skill library that keeps one copy of each skill on this computer, with search, contents and the bots that use each skill. Bot settings › Skills adds Add from library…, and each switch affects only that bot. Skills installed from a ZIP or GitHub and the skills you saved are listed in the library too, without importing again.

### Improvements and fixes

- **Shared skills say who else is affected:** replacing a skill several bots use with a ZIP or GitHub link, or updating one of My skills that is on in several bots, now names the other bots that get the change.
- **Deleting a bot keeps its skills:** the skills it had installed stay in My skill library, ready to add to another bot or to remove from the library.

## 0.1.47 - 2026-11-23

### New

- **Images as image-generation references:** when you're signed in to Modelflare and add images in a one-on-one chat with a bot, a “Use as image-generation references” switch appears next to the attachment count, off by default. Turn it on and the images in that message become references in display order; the model selected at the bottom right generates the image and the result comes back to the same chat. Adding images alone never starts a paid generation. If the current model can't do it, its capabilities can't be verified yet, or the images exceed the model's count, format or size limits, a note above the message box explains why, and its “Switch models” link opens the usual model picker. Cost confirmation works as before (every time, or when the estimate is above $0.5), and an unconfirmed result is never retried automatically. Requires model capability information from Modelflare; nothing is sent when it can't be verified. Not available with custom API keys yet.
- **Pick image-generation models in the model picker:** when you're signed in, the model picker at the bottom right also lists the image-generation models your account can use. Select one and just describe the picture you want; no chat model is involved.

### Improvements and fixes

- **Image generation uses the selected model only:** when you're signed in and ask a bot in plain words for an image, it uses only the model selected at the bottom right. If that model can't generate images or its capabilities can't be verified, the bot says so and asks you to switch, instead of using a separate default image model (the “Default image model” setting is hidden while signed in). Nothing changes when you connect with an API key only.

## 0.1.46 - 2026-11-22

### New

- **Work folder:** in the desktop app, choose a folder above the message box and the bot works on the files right where they are, without dragging them in one by one. With Workspace access the bot can edit files in that folder without asking each time; writing anywhere else still needs your approval. Each message keeps the folder chosen when it was sent, so switching folders while it is queued or waiting for approval never redirects it, and background tasks started from it work in the same folder. Your 10 most recent folders are one click away; the app's data folder, a disk root and your home folder itself can't be chosen. The web console shows the chosen folder, but you choose or change it in the desktop app on the bot's machine.
- **ZIP attachments:** drag a ZIP (up to 50 MiB) into a chat and send it with images and files, or on its own. The bot only looks inside or extracts it after you say what to do, into its own workspace by default or into the work folder if you ask, and never runs anything from it on its own. Encrypted or split ZIPs, unsafe paths and archives that expand beyond 200 MiB or 2,000 entries are refused with the reason. Click a sent ZIP to save the original file. Needs agent mode.

### Improvements and fixes

- **Attachments:** when you drag in several files, the ones that can be added are added and the rest are listed in one line with the reason, instead of the whole batch being rejected. File cards show the file type and keep the extension visible on long names.

## 0.1.45 - 2026-11-22

### Improvements and fixes

- **Command sandbox (Linux):** commands a bot runs now run only inside the bubblewrap sandbox. If bubblewrap is not installed, or the system does not let it create namespaces, the command is refused with the reason and how to fix it (install bubblewrap or allow it), instead of quietly falling back to a sandbox that only restricts writes and lets commands read the app's data directory. Bots with full access are not affected. The official Docker image still allows that fallback by default, because a container started with default options cannot create the namespaces bubblewrap needs; add `-e AMB_ALLOW_LANDLOCK=0` to turn it off.
- **Access token for the command-line version:** when you run with `npm start`, the local console now needs an access token too. Started from a terminal, it prints a link with the token once; open it in your browser and the browser remembers it. The token is also saved in `ui-token` in the data directory, and `npm run bot` reads it automatically. The desktop app and Docker work as before.

## 0.1.44 - 2026-11-20

### Improvements and fixes

- **Image attachments:** several kinds of images were rejected as an unsupported format when dragged or pasted into a chat and are now accepted: images whose extension does not match their real format (a PNG or WebP saved as .jpg, for example), phone JPEGs with extra data after the image and motion photos (only the still frame is used), and images with a .jfif or .jpe extension. An image that really cannot be added now asks you to convert it to PNG or JPG instead of telling you to use Markdown, HTML or TXT.
- **Preview security:** when you preview a web page a bot generated, the page's scripts can no longer read the contents of other files in the same folder (fetch is blocked); styles, scripts, images and fonts load as before. Data files such as JSON are no longer served to previewed pages, so inline the data in the HTML or ship it as a script.
- **In-app updates:** on macOS, the "AnyModelBot ran into a problem" window no longer appears during installation after you click Restart and update. The fix takes effect from 0.1.44 on: the window can still appear once while updating to 0.1.44 from an older version, and the update completes normally.

## 0.1.43 - 2026-11-20

### New

- **Image and file attachments:** paste a screenshot or image into a chat, or drag in images and text files (Markdown, HTML, TXT, CSV, JSON, code and more), and send them with your message. You can also send attachments on their own. Images go to models that can see images, and the full text of files goes to the model to read; click a thumbnail to enlarge it. Each message takes up to 8 attachments, including up to 4 images, at up to 10 MiB each. If the current model does not support images, the app tells you. PDF, Office documents, archives, audio and video are not supported yet.
- **Requests & Feedback:** Feedback is now Requests & Feedback, with three categories: Use cases & ideas, Problems, and Business & partnerships. Each keeps its own draft. Contact details are left out unless you tick the consent box for that submission, logs are included only if you tick them, and you can view everything that will be sent first. Discover has a new section for business scenarios.

### Improvements and fixes

- **Organising files on your computer:** asking a bot to tidy files on the Desktop or in other folders no longer asks for Accessibility or Screen Recording first; anything outside its workspace still needs your approval. When a task really needs to operate a desktop app and a system permission is missing, a permission card appears in the chat for you to turn it on.
- **Preview:** with focus in the preview, Cmd+W / Ctrl+W closes only the current tab; the empty preview and the + menu list the files opened in this chat.
- **Skills:** Save as skill drafts the most recently finished request by default; choices on the draft card survive editing; the import toast and cards no longer stay on "Loading".
- **Chat and tasks:** the chat stays at the bottom when content or the composer grows, so notes and cards are not hidden behind the composer; a bot's Tasks tab lists work sent by other bots and says who sent it.

## 0.1.42 - 2026-11-18

### New

- **In-app feedback:** open the feedback window from Feedback in the account menu, "Report this problem" under an error in chat, Settings → Troubleshooting or Settings → About. Choose Problem, Suggestion or Other, write a few lines and send. The version and system details are always included, and opening it from an error adds that error. Diagnostics are included only if you tick the box, you can preview the full text before sending, and conversations and screenshots are never attached. When you're signed in to Modelflare, your feedback becomes a support ticket on your account: replies are emailed to you and appear on Modelflare's tickets page, up to 3 a day. Without a sign-in you can send it on GitHub or by email, with the details filled in for you.

### Improvements and fixes

- **Email links:** in the desktop app, email links in chat now open your system's mail app. Before, clicking them did nothing.

## 0.1.41 - 2026-11-16

### New

- **Turkish:** The interface, tray menu, system messages from bots, website and documentation are available in Turkish. Pick Türkçe during setup or in Settings → General → Language. If your system language is Turkish, the app uses it automatically. The percent sign comes before the number, and US Stock Research charts read that form. The homepage demo is still the English recording.

## 0.1.40 - 2026-11-15

### New

- **Task library:** the Scheduled page adds 20 ready-made tasks for news, work, learning, daily life and finance. Pick one, fill in a few fields, choose a bot and destination, then turn it on; you can also ask a bot to create a library rule in chat. Check tasks can be tried once first, with results shown only in the trial dialog and run log, without sending them to chat channels. The computer and app must be running.
- **Richer file previews:** code gains line numbers, syntax highlighting and wrapping; JSON supports formatting and folding; CSV/TSV supports tables, sorting, search and encoding selection. Markdown supports images, task lists, an outline and source view; images support zoom and pan; HTML switches between preview and source.

### Improvements and fixes

- **Preview controls and refresh:** tabs have file-type icons and context menus, and "+" lists files delivered in the chat. Expand the panel to fill the app, keep view, zoom and wrapping preferences, and refresh when files change. Desktop supports Save as, Show in folder and opening HTML in a browser.
- **Rule schedules and results:** add yearly reminders and reminders a few days before monthly or yearly dates. Library checks can send multi-line briefs, trial costs count toward monthly usage, and common cron schedules are easier to read.
- **Website:** the community text menu opens on hover or keyboard focus, the home feature section is simpler, and the changelog shows only published versions.

## 0.1.39 - 2026-11-15

### New

- **Know what to say right after setup:** after you import a skill ZIP or assign an app to a bot under **Skills & apps**, the confirmation adds a **Try saying** example with **Insert into the input** and **Copy**.

### Improvements and fixes

- **New conversations start right away:** the new-conversation button, **New conversation** in the + menu and typing /new switch to a fresh conversation at once and leave a "New conversation started" line in the chat (still there after a reload or restart). No more "/new" bubble stuck on "Thinking". Where you left off is written up as a handoff note in the background, and the first message of the new conversation waits for it for at most 8 seconds. The button is grayed out while a reply is running. /new in chat apps replies right away too.
- **Your name and picture in the account area:** after you sign in to Modelflare, the bottom-left corner and the account menu show your nickname and profile picture (or your own username, then your email; the first letter of your name when there is no picture) instead of "Modelflare account". After a restart, your last name shows right away.
- **The process shows which tool was used:** each app tool gets its own line, such as "Using Notion · Search pages", folding into "Used: Notion · Search pages, Notion · Read page" when the reply ends.
- **A clearer skills list:** **Apps & skills › Skills** now shows cards. Author pictures start as initials, fade in once loaded and are kept on your device, so they show at once next time. **GitHub ↗** and **Copy install prompt** are always visible and no longer squeeze the title.
- **Settings make clickable things obvious:** actions in Settings and bot settings are small pill buttons, with Delete, Remove and Sign out in red. A row with a single "View" is clickable as a whole, and a row has at most two buttons, with the rest under "⋯".
- **Pickers and small fixes:** the **Provider** picker on the **Use your own API key** page and the switcher in Preview keep their arrow at the right edge and open from anywhere on the row. A skill that is set up but not active yet says "Ready from your next message". For built-in bots you haven't used yet, the sidebar "⋯" no longer covers the "new" dot.

## 0.1.38 - 2026-11-15

### New

- **Switches back to the real model:** a model you picked earlier that was really "auto/…" (the global default, a bot's default or a model switched in a chat) changes to the matching real model at startup, or back to the default if there is none.

### Improvements and fixes

- **No more "auto/…" models in the model list:** when a model was offered by more than one source (for example a bot with its own budget, or an official API key added alongside Modelflare), the list gained an entry that looked like the original but was really "auto/model-name", and picking it made requests fail with an unknown model. It is no longer listed or sent.

## 0.1.37 - 2026-11-15

### New

- **About me:** team memory is now About me, for things about you that all your bots share. Say it once in any chat (like "I'm Melody") and every bot knows; a one-line note under the reply lets you undo it. Bots ask before saving an address, phone number or email, never change back lines you edited yourself, and don't add back lines you deleted. View and edit it in Settings › About me, where every change from the last 30 days can be undone. Your old team memory moves over automatically.
- **Bots can message each other:** in the app, tell a bot "hand this to Product Assistant" and it sends the task, background and files to that bot. The other bot works in the background with its own model, permissions and budget, asks for your approval in the same chat under its own name, and replies when done. The first bot checks the result, asks for a redo if needed, and then tells you. Click the gray line in the chat to see their conversation. Requires signing in to Modelflare, with both bots on Modelflare models.
- **Bot collaboration settings:** turn it off or set limits for spend, time, daily requests and redos per request in Settings › Bot collaboration, and browse the conversations between bots and what they cost.

### Improvements and fixes

- **Bot settings and the Memory tab:** the per-bot "Allow writing to team memory" switch is replaced by an About me link. The Memory tab shows how many About me lines there are, where you can view or delete them.
- **Memory review:** facts about you no longer go into a single bot's memory; About me wins when they conflict.

## 0.1.36 - 2026-11-15

### New

- **Save what you did as a skill:** once a bot gets something right, choose "Save as skill…" from the input box's + menu, send `/skill`, or just say "save as skill". The bot drafts a card with the steps, what you corrected, the apps and skills it used, and a "Try saying" line. Save it to My skills, turn it on for other bots with one switch, or schedule it. Secrets are never written into a skill, and personal details such as phone numbers and emails default to being asked each time. You can update a skill, restore the previous version or export it as a ZIP.
- **Skill library:** Connect apps is now Apps & skills, with a new Skills tab listing 155 skills from 31 open-source repositories, by category and by author. Copy an install prompt and send it to any bot, or send a skill's GitHub link, then confirm the card to install it.
- **Use skills and apps in a chat:** + → Skills & apps in the input box lists what the bot can use; pick one to insert "Use {name} to help me…". Above the reply you see which skills and apps are in use or were used, and skill names open their details.

### Improvements and fixes

- **An easier skill list:** skills that are on come first. With more than 10, search and filter by My skills, GitHub, Local ZIP or Off. Each skill shows whether it's active, where it came from and a "Try saying" line.
- **Templates during trial credits:** templates use a model tier that fits your current credits and say which tier they normally recommend.
- **Computer use permissions:** when a background task is stopped by a missing permission, the permission card now appears, and no orphaned waiting state is left behind.
- **Getting started and notices:** clicking a blocked checklist step explains why. Notices now appear at the top center of the main area.
- **Scheduled rules:** an expanded rule is split into prompt, frequency, next run and destination. Choosing a bot uses a searchable list, and new rules start with cards for "Send a reminder" or "Do a task", which can follow one of My skills. Empty states and the time zone notice are clearer.
- **Updates, account and details:** the update entry names the version. Account details can be retried if they fail to load, Sign out is red, group chats in the app show a top-up action when the balance runs out, template cards have borders and their links drop the arrow.

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
- **Custom connectors (MCP):** Add them under My MCP on the Apps page. Paste a URL, mcpServers JSON, a `claude mcp add` command or a local start command and it is recognized; you can also fill in the form or edit JSON. Remote servers and local commands both work, with sign-in, headers, query parameters or a dedicated URL for authentication, up to 20 connectors.
- **Asks before changing your data:** Read-only tools run right away. Writes ask you in the chat first by default, and you can choose Always allow this tool, which you can revoke later in the bot's settings. Deletes and anything sent to other people always ask. Read-only bots can't write.
- **Fix a connection from the chat:** When a task needs an app that isn't connected, or a sign-in has expired or a key stopped working, a card appears in the chat. Click it to connect or fix it, and the bot carries on with the task.
- **Right panel:** The info panel is now a row of tabs: Overview, Tasks and Memory. Official bots add a Workspace tab for their own interface, and the main area is always the chat.
- **Sidebar sections:** Put bots, group chats and official bots into sections you create. Sections can be added, renamed, deleted and dragged to reorder.
- **Official bots have their own look:** PPT Master, Film Studio, Company Research and US Stock Research each get their own avatar and a new cover. Bots whose avatar you haven't changed switch automatically.

### Improvements and fixes

- Settings › Connections is now Chat channels and only holds chat app accounts. Your existing Notion accounts moved to Connect apps and don't need to be authorized again.
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

### Improved

- **Web search no longer needs a DeepSeek key:** It's free by default, and you can switch to Tavily, Exa, Bocha, Zhipu or your own SearXNG.
- **Characters are separate from roles:** An avatar only sets a bot's looks, and picking a template doesn't change it.

### Changed

- Chat channel setup moved from each bot's info panel to Settings › Connections. Existing accounts move over automatically with no new sign-in, and the same bot still answers by default.
- Owners and allow lists now belong to the account, so anyone allowed on it can talk to any bot. Deleting a bot no longer affects accounts.
