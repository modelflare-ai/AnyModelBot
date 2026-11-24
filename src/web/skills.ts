import type http from "node:http";
import { readSkillZip, SkillError, SKILL_LIMITS } from "../skills/archive.js";
import type { UserSkills } from "../skills/service.js";
import { skillDisplay, skillState, type SkillRuntime } from "../skills/display.js";
import type { MySkill } from "../skills/mine.js";

async function readZip(req: http.IncomingMessage): Promise<Buffer> {
  if (!String(req.headers["content-type"] ?? "").split(";")[0].trim().match(/^(application\/zip|application\/octet-stream)$/)) throw new SkillError("invalid_zip", 415);
  if (Number(req.headers["content-length"]) > SKILL_LIMITS.zip) { req.resume(); throw new SkillError("too_large", 413); }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > SKILL_LIMITS.zip) throw new SkillError("too_large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * 列表里每个技能带上给用户看的名字、简介、「试试这样说」（skills/display.ts），现在生效了没有（state），
 * 以及模型能不能自己用它（modelInvocable：不能的不进加号菜单，设置里说明怎么用）。
 */
export function skillsView(botId: string, skills: UserSkills, runtime?: SkillRuntime) {
  const own = skills.list(botId).map((s) => ({ ...s, ...skillDisplay(s), state: skillState(s, runtime), modelInvocable: skills.modelInvocable(botId, s) }));
  // 「我的技能」：每个机器人都列出全部，在这个机器人上打开的算开着（skills/mine.ts）。和已装技能重名的不列（那一行是已装的）
  const mine = skills.mine
    .list()
    .filter((m) => !own.some((x) => x.name === m.name))
    .map((m) => {
      const enabled = m.bots.includes(botId);
      return {
        name: m.name,
        description: m.description,
        digest: m.digest,
        enabled,
        files: 1,
        bytes: 0,
        source: { type: "mine" as const, installedAt: m.savedAt },
        title: m.title,
        summary: m.description,
        example: m.example,
        state: skillState({ name: m.name, digest: m.digest, enabled }, runtime),
        modelInvocable: true,
        mine: mySkillInfo(m),
      };
    });
  // 库里和这个机器人有使用关系的条目（从本机导入的、登记进库的）：开关只影响这个机器人
  const lib = skills.library.forBot(botId).map((e) => {
    const enabled = !!e.uses[botId]?.on;
    const d = skillDisplay({ name: e.name, description: e.description, source: e.source.type === "local" ? undefined : e.source, title: e.title, ...(e.example ? { example: e.example } : {}) });
    return {
      name: e.name,
      description: e.description,
      digest: e.digest,
      enabled,
      files: e.files,
      bytes: e.bytes,
      source: e.source,
      ...d,
      state: skillState({ name: e.name, digest: e.digest, enabled }, runtime),
      modelInvocable: skills.modelInvocable(botId, { digest: e.digest, library: true }),
      library: { id: e.id, imported: !!e.imported, shared: skills.sharedBots(e, botId), scripts: e.scripts, depsUnverified: !!e.depsUnverified },
    };
  });
  return [...own, ...mine, ...lib];
}

/** 「我的技能」给界面的详情字段：未验证、保存时间、保存它的机器人、打开的机器人、上一版、用到的应用和技能、定时运行做不了的步骤 */
export function mySkillInfo(m: MySkill) {
  return {
    unverified: m.unverified,
    savedAt: m.savedAt,
    createdAt: m.createdAt,
    savedBy: m.savedBy,
    savedByName: m.savedByName,
    bots: m.bots,
    prev: m.prev ? { savedAt: m.prev.savedAt, title: m.prev.title } : null,
    apps: m.apps,
    uses: m.uses,
    blocked: m.blocked,
    asks: m.asks,
    kept: m.kept,
  };
}

/** 沿用 /amb/api 的令牌、跨站预检和代理进程访问检查。ZIP 按二进制上传，不经过 JSON/base64。runtime：机器人进程里技能的现状 */
export async function skillsApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, botId: string, tail: string[], skills: UserSkills, readJson: (req: http.IncomingMessage) => Promise<any>, changed: () => void, runtime: () => SkillRuntime | undefined = () => undefined): Promise<void> {
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  try {
    if (req.method === "GET" && !tail.length) return send(200, { skills: skillsView(botId, skills, runtime()) });
    // 「我的技能」（这个机器人没装同名技能时）：详情是同一份只读详情，开关只影响这个机器人
    const mine = tail.length === 1 && !skills.list(botId).some((s) => s.name === tail[0]) ? skills.mine.get(tail[0]) : undefined;
    if (mine && req.method === "GET") return send(200, { skill: { ...mine, ...mySkillInfo(mine), source: { type: "mine", installedAt: mine.savedAt }, instructions: skills.mine.text(mine.name), files: 1, bytes: 0 } });
    if (mine && req.method === "PUT") {
      const body = await readJson(req);
      if (typeof body?.enabled !== "boolean") throw new SkillError("invalid_skill");
      // 打开时查重名：和这个机器人已装的技能、自带技能、保留名相同的不打开
      if (body.enabled && !skills.mineAvailable(botId, mine.name)) throw new SkillError("reserved_name", 409, { name: mine.name });
      skills.mine.setEnabled(mine.name, botId, body.enabled);
      changed();
      return send(200, { skills: skillsView(botId, skills, runtime()) });
    }
    if (req.method === "GET" && tail.length === 1) return send(200, { skill: skills.detail(botId, tail[0]) });
    if (req.method === "POST" && (!tail.length || (tail.length === 1 && tail[0] === "preview"))) {
      const pkg = await readSkillZip(await readZip(req));
      if (tail.length) return send(200, { skill: skills.preview(botId, pkg) });
      skills.install(botId, pkg, url.searchParams.get("replaces"));
    } else if (req.method === "PUT" && tail.length === 1) {
      const body = await readJson(req);
      if (typeof body?.enabled !== "boolean") throw new SkillError("invalid_skill");
      skills.setEnabled(botId, tail[0], body.enabled);
    } else if (req.method === "DELETE" && tail.length === 1) skills.remove(botId, tail[0]);
    else throw new SkillError("not_found", 404);
    changed();
    send(200, { skills: skillsView(botId, skills, runtime()) });
  } catch (e) {
    if (!(e instanceof SkillError)) throw e;
    send(e.status, { error: e.code, code: e.code, ...e.detail });
  }
}
