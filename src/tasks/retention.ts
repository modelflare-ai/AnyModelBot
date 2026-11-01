/**
 * 保留与清理（设计第 11 节「Disk growth」、决定 9，3f）的纯函数部分；写库、删文件的是任务服务（service.ts 的 retain）。
 *
 * - 任务和运行记录留 30 天：30 天没动过的任务归档（不再列出、不能再追加，等着的提问作废），运行记录只留 30 天
 *   （每个任务最近的那个 run 留着：阶段看它）。
 * - 任务文件夹留到任务删掉为止；30 天没动过就清理，连同 DSH 里这个任务的会话记录。不问用户、不发通知（产品负责人
 *   2026-11-01）：第 27 天定下清理的日期，任务详情里写着，可以保留；定下之后至少 3 天才删。文件夹是空的直接归档。
 * - 状态都在库里（tasks.cleanup_at），重启不影响；时间都从任务服务的时钟取（测试用假时钟）。
 */
import fs from "node:fs";
import path from "node:path";

export const DAY_MS = 86_400_000;
/** 任务、运行记录、没动过的文件夹留多久 */
export const KEEP_MS = 30 * DAY_MS;
/** 定下清理日期之后至少等多久才删（任务详情里看得到日期，可以保留） */
export const WARN_MS = 3 * DAY_MS;
/** 多久看一次 */
export const SWEEP_MS = 3600_000;

/** 目录占多大（字节）：不跟链接，最多看 limit 个条目（很大的文件夹算个大概） */
export function dirBytes(dir: string, limit = 20_000): number {
  let total = 0;
  let seen = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (++seen > limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* 刚被删了 */
        }
      }
    }
  };
  walk(dir);
  return total;
}

/** 目录里有没有东西（不存在、空的都算没有） */
export function hasFiles(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * 任务会话在 DSH 里的记录：DSH_HOME/sessions/<工作目录>/<会话 id>/（dsh-session-persistence-jsonl 的布局，会话 id 里只有
 * 字母数字和 -_，目录名就是 id）。task-<id>，以及恢复不了时换过的 task-<id>-N。SDK 没有删会话的接口，宿主直接删目录。
 */
export function taskSessionDirs(home: string, taskId: string): string[] {
  const root = path.join(home, "sessions");
  const name = `task-${taskId}`;
  const out: string[] = [];
  let projects: fs.Dirent[];
  try {
    projects = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    let sessions: string[];
    try {
      sessions = fs.readdirSync(path.join(root, p.name));
    } catch {
      continue;
    }
    for (const s of sessions) if (s === name || (s.startsWith(name + "-") && /^\d+$/.test(s.slice(name.length + 1)))) out.push(path.join(root, p.name, s));
  }
  return out;
}

/** 任务文件夹的绝对路径：只认工作区 tasks/ 下面的（库里的值不对就不碰） */
export function taskFolder(workspace: string, folder: string): string | undefined {
  const base = path.resolve(workspace, "tasks");
  const abs = path.resolve(workspace, folder);
  return abs.startsWith(base + path.sep) ? abs : undefined;
}
