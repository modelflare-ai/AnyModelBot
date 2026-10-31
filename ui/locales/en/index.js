// en 文案：每个命名空间一个文件，键 = "命名空间.键"（见 ui/lib/i18n.js）。两种语言的键必须一一对应（test/i18n.unit.test.ts 会查）。
import common from "./common.js";
import app from "./app.js";
import time from "./time.js";
import settings from "./settings.js";
import account from "./account.js";
import pwsh from "./pwsh.js";
import chat from "./chat.js";
import info from "./info.js";
import markdown from "./markdown.js";
import notify from "./notify.js";
import troubleshoot from "./troubleshoot.js";
import onboarding from "./onboarding.js";
import newBot from "./newBot.js";
import botSettings from "./botSettings.js";
import sidebar from "./sidebar.js";
import avatar from "./avatar.js";
import models from "./models.js";
import ui from "./ui.js";
import guide from "./guide.js";
import activity from "./activity.js";
import tasks from "./tasks.js";
import needs from "./needs.js";
import access from "./access.js";
import perms from "./perms.js";

export default { common, app, time, settings, account, pwsh, chat, info, markdown, notify, troubleshoot, onboarding, newBot, botSettings, sidebar, avatar, models, ui, guide, activity, perms, access, tasks, needs };
