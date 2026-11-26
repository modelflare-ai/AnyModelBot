# Import and manage skills

[简体中文](./skills.md) | [繁體中文（台灣）](./skills_zh-TW.md) | English | [日本語](./skills_ja.md) | [한국어](./skills_ko.md) | [Русский](./skills_ru.md) | [Español](./skills_es.md) | [Português (Brasil)](./skills_pt.md) | [Türkçe](./skills_tr.md)

Starting with AnyModelBot 0.1.24, you can add existing workflows to a bot as ZIP skill packages, for tasks such as weekly reports, document processing and research.

## Import

1. Open the target bot's settings, find Skills and click Import ZIP.
2. Select a local ZIP and review its name, description and file count. Expand the instructions to read them in full.
3. Click Add skill. The bot can load it when a relevant task needs it.

Each ZIP contains one skill. `SKILL.md` can be at the ZIP root or inside a wrapper folder. Supporting files such as `scripts/`, `references/` and `assets/` are preserved. Importing does not contact GitHub or automatically execute installation scripts.

`SKILL.md` needs YAML frontmatter and an instruction body, for example:

```markdown
---
name: weekly-report
description: Write weekly reports from the user's work notes.
---

Organize completed work, problems and next week's plans, then use the user's requested format.
```

Names use lowercase English letters, digits and single hyphens, up to 64 characters. ZIP files can be up to 20 MB, with up to 64 MB and 2,000 entries after extraction. `SKILL.md` can be up to 256 KB, and each bot can have up to 100 imported skills. If a ZIP contains several `SKILL.md` files, package each skill separately.

## Install from the skill library or GitHub

- Open the Skills tab in Apps & skills to browse the skill library by category or author; the skill section in bot settings also has Browse skills. Click "Copy install prompt" and send it to any bot.
- You can also send a skill's GitHub link to a bot (a repository, a `/tree/<branch>/<path>` folder or a `SKILL.md` file) and say "install this".
- The bot reads the skill's name, description, source, license and file count and shows a confirmation card. Nothing is written until you click Install, and the skill is installed only for that bot. In chat channels, reply with the code on the card; Feishu cards have buttons. Only the owner can install skills.
- Installed skills show their source as "GitHub · repository" in the list; View shows the repository, path, branch, the commit installed and the install time.

## Import from this machine (My skill library)

Skills already installed for other tools on your computer (such as Claude Code, Codex, Cursor or CodeBuddy) can be imported into My skill library in one go and then turned on for your bots.

- Where: avatar menu › My skill library › Import from this machine…, or bot settings › Skills › Import from this machine…. Finding skills works only in the desktop app on the computer that holds the library; in a browser or remote session, keep using a ZIP or a GitHub link.
- Six places are searched automatically: `~/.codebuddy/skills/`, `~/.qwenworkcn/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` and `~/.codex/skills/`. Only folders and `SKILL.md` file names are listed; no instructions, memories or accounts are read. For other places (such as `~/.workbuddy/skills/`, Doubao's `.user_skills/` or a project), use Choose folder…; for a project only known places such as `.claude/skills/` are checked. Your home folder, a disk root and the app-data root are never searched as a whole.
- Nothing is selected at first. Only after you select skills and click Next are they read. The review lists each one as ready to import, already exists (identical content; its state is kept), same name with different content (skipped by default; choose Save separately to keep the invocation name and add a suffix to the shown name), or incompatible (with the reason). Skills with scripts are marked “Contains scripts; importing will not run them”, and skills with dependencies “Dependencies not verified”.
- Coming from a bot, “Use in {bot} after import” is ticked; coming from the library, skills are only added to the library. Afterwards you get the counts of added, enabled, skipped and failed. If enabling fails (a skill with the same name is on, or the bot is full), the added content stays in the library.
- Not imported: skills with possible private files (`.env`, `id_rsa`, `credentials.json`, `memory.md`, …), links pointing outside the chosen location, restrictions this app can't keep the same way (such as `allowed-tools` or `hooks`), platform path variables (such as `${CLAUDE_PLUGIN_ROOT}`) or missing referenced files. `disable-model-invocation` and `user-invocable` are kept as they are; Codex's `allow_implicit_invocation: false` is written as `disable-model-invocation: true`.
- Importing copies: the source is unchanged and never synced. Each skill is stored once in the library and each bot only keeps an on/off switch: Add from library… in bot settings, or the switch, affects only that bot. ZIP and GitHub skills installed on bots and your saved skills are listed in the library too.
- In My skill library, open a skill to see its contents and the bots that use it. When no bot has an imported skill on, ⋯ › Remove from library deletes the library copy only.

## Use, replace and delete

- A skill applies only to the bot you add it to (see My skills below). That bot uses the same skills in the app and through chat channels.
- View instructions, enable, disable or delete skills in the list. Changes wait until the bot is idle.
- After an import, the confirmation says when the skill is ready (from your next message, after the current task, or once it has loaded) and shows a **Try saying** example with **Insert into the input** (opens this bot's chat) and **Copy**. It stays until you use a button or close it.
- Import a skill with the same name again, review it and click Replace skill. Replacement preserves its enabled or disabled state.
- Deleting a skill removes its files and keeps output already generated in the workspace.
- Built-in names such as `media`, `computer-use` and `amb-app`, and skills supplied by catalog bots, cannot be overwritten by imported packages.

Skills run with the bot's existing permissions. A skill that needs Python, other software or an account connection requires that environment. Skills relying on tools specific to another client may need changes. Format compatibility does not mean every supporting tool is installed.

## Use in a chat

- Click **+** › **Skills & apps** at the left of the message box to see the skills and apps this bot can use now. Click one to put "Use {name} to help me…" in the message box, finish the sentence and send it. The bot decides whether to use it.
- In settings, each skill shows **Active**, **Ready from your next message** or **Loading** next to its name, with a **Try saying** line below. Click that line to put the example in this bot's message box.
- While the bot uses a skill or app, the process above its reply shows "Using skill · {name}", or one line per tool for apps: "Using {app} · {tool}" (with the tool's display name when the app provides one). When the reply ends, this folds into one line, "Used: …", which you can expand to see every step.
- Ask the bot "What skills do you have?" or "What apps do you have?" and it lists the ones it can use now, each with an example you can send.
- A skill whose `SKILL.md` sets `disable-model-invocation: true` is never used by the bot on its own and doesn't appear in **Skills & apps**. Write `/skill-name` in a message to use it.

## Save what you did as a skill

Once a bot has done something right, you can save how it did it to My skills, use it next time, or put it on a schedule.

- Start: in the input box's + menu choose "Save as skill…", send `/skill`, or just say "save as skill". To keep only part, say "save step 3 as a skill". If the bot is still replying, it waits for this turn to finish.
- The bot shows "Putting the skill together…", then a draft card: title and file name, when to use it, steps, what you corrected (you can uncheck items), apps and skills it uses, and "Try saying". "Edit" opens the skill file itself and checks it again when you're done. Nothing is written until you click Save; the card expires after 30 minutes.
- Secrets (API keys, tokens, passwords, verification codes, cookies, ID numbers) are never written into the skill, and can't be saved if you add them back while editing. Phone numbers, emails, names, group names and file paths outside the workspace are highlighted and default to "Ask each time": they become placeholders, and the bot asks you before each use. Choose "Keep" to write the original into the skill.
- You can save an unfinished task too: the draft says where it got stuck and the skill is marked "Not verified" until it completes successfully once.
- If the title matches, or the bot sees it's the same task, the card shows how many places changed and offers "Update" or "Save as new". Updating keeps the previous version, which you can restore under Manage.
- My skills is a single list kept only on this computer, up to 100 skills, counted separately from each bot's imported skills. A skill starts on only for the bot that saved it; turn on its switch in another bot's skill list to use it there. Only the owner can save skills, and not from a WeChat or Feishu group.
- In the skill list, My skills rows have "View" and "Manage". Manage lets you export a ZIP (only this skill's own files, with a reminder if it keeps personal info), restore the previous version, or delete it. An exported ZIP can be imported on another computer as a local ZIP skill.
- After saving, "Schedule it" makes the bot ask for a time and create a "Do a task" rule that always runs the latest version. Skills that need computer use, image or video generation, or background tasks, and skills that aren't verified, can't be scheduled. If the skill is deleted, turned off for that bot, or after an update or restore needs new answers, gains steps scheduled runs can't do, or becomes not verified, the rule pauses and shows under Needs attention in Scheduled.
- With more than 10 skills, the list gets a search box and "All / My skills / GitHub / Local ZIP / Off" filters. Skill names in the activity line open the skill's details.

## Storage

Extracted packages are stored under `skills/<bot ID>/` in the data directory. Enabled skills are copied to `dsh/<bot ID>/skills/` for the runtime. Import uploads only to the AnyModelBot instance you are using; for a server deployment, files are stored on that server. Enabled skill names and descriptions, and instructions or references loaded during use, become context sent to your selected model. See [Data and privacy](./privacy_en.md).

My skills live in `my-skills/` in the data directory and are copied at runtime into `dsh/<bot ID>/skills/` for each bot they're turned on for.

Skills imported from this machine are stored in `skill-library/` in the data directory and copied at runtime into `dsh/<bot ID>/skills/` for each bot that has them on. Deleting a bot keeps the skills it had installed in My skill library.
