/**
 * 数据目录锁（设计文档第 11 节「Two hosts open the same data dir」）：同一个数据目录只能有一个宿主在跑，
 * 不然两个调度器会把同一条规则跑两遍、两个渠道连接抢同一个微信。桌面版本来就有 Electron 的单实例锁；
 * 命令行和 Docker 靠这个，在调度器开始之前拿到。
 *
 * 锁是 <dataDir>/anymodel.lock：{pid, host, at}。拿锁时：没有、或是自己的（同一进程重启 App），直接拿；
 * 那个进程已经不在了（崩溃、kill -9），或者心跳停了 3 分钟以上（断电重启后进程号被别的程序占了、另一台机器上的宿主没了），接管。
 * 心跳：拿着锁的每分钟碰一下文件（两个容器挂同一个卷时只能靠它）。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../log.js";

const log = logger("lock");

export const LOCK_FILE = "anymodel.lock";
/** 心跳：拿着锁的多久碰一下文件；别的机器上的锁多久没碰算没人了 */
export const HEARTBEAT_MS = 60_000;
export const STALE_MS = 3 * 60_000;

export class DataDirLocked extends Error {
  constructor(
    readonly dataDir: string,
    readonly holder: { pid: number; host: string },
  ) {
    super(`数据目录 ${dataDir} 正被另一个 anymodel bot 进程使用（${holder.host === os.hostname() ? "" : `${holder.host} 上的 `}pid ${holder.pid}）。先退出它，或者换一个数据目录（AMB_DATA_DIR）。`);
    this.name = "DataDirLocked";
  }
}

interface Holder {
  pid: number;
  host: string;
  at: number;
  /** 这一次拿锁的标记（同一进程里先后两个 App：只放自己拿的那把） */
  token: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM：进程在，只是不是我们的
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function read(file: string): Holder | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return Number(j?.pid) > 0 ? { pid: Number(j.pid), host: String(j.host ?? ""), at: Number(j.at) || 0, token: String(j.token ?? "") } : undefined;
  } catch {
    return undefined;
  }
}

/** 拿着的锁：release() 放掉（只放自己的） */
export interface DataDirLock {
  file: string;
  release(): void;
}

/** 拿数据目录锁；被另一个活着的进程拿着时抛 DataDirLocked */
export function lockDataDir(dataDir: string, o: { now?: () => number; heartbeatMs?: number } = {}): DataDirLock {
  const now = o.now ?? Date.now;
  const file = path.join(dataDir, LOCK_FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  const me: Holder = { pid: process.pid, host: os.hostname(), at: now(), token: randomUUID() };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(me), { flag: "wx", mode: 0o600 });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const h = read(file);
    const mtime = (() => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        return 0;
      }
    })();
    const mine = h && h.pid === me.pid && h.host === me.host;
    // 同一台机器：进程不在了就接管；进程号还在但心跳停了 3 分钟以上也接管（崩溃或断电重启后，旧进程号可能被别的程序用了）
    const stale = !!h && now() - Math.max(h.at, mtime) > STALE_MS;
    const gone = !h || stale || (h.host === me.host && !alive(h.pid));
    if (!mine && !gone) throw new DataDirLocked(dataDir, h!);
    if (h && !mine) log.warn("taking over a stale data dir lock", { pid: h.pid, host: h.host });
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 下一轮再试 */
    }
  }
  if (read(file)?.token !== me.token) throw new DataDirLocked(dataDir, read(file) ?? me);
  // 心跳：另一台机器上的宿主据此判断这把锁还有没有人
  const beat = setInterval(() => {
    try {
      const t = new Date(now());
      fs.utimesSync(file, t, t);
    } catch {
      /* 文件没了：下次启动重新拿 */
    }
  }, o.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref?.();
  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      clearInterval(beat);
      const h = read(file);
      if (h?.token === me.token) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          /* ignore */
        }
      }
    },
  };
}
