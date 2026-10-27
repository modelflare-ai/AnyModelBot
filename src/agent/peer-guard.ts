import fs from "node:fs";

/**
 * 判断一条回环 TCP 连接是否来自 DSH 子进程（或其沙箱内的工具进程）。
 * 用途：代理可以在沙箱里访问 127.0.0.1，必须阻止它调用本机管理 API 自行批准审批。
 * 仅 Linux 实现（/proc）；其他平台返回 false。
 */
export function connectionFromPids(remotePort: number | undefined, localPort: number | undefined, rootPids: number[]): boolean {
  if (process.platform !== "linux" || !remotePort || !localPort || !rootPids.length) return false;
  const inode = socketInode(remotePort, localPort);
  if (!inode) return false;
  const target = `socket:[${inode}]`;
  for (const pid of descendants(rootPids)) {
    let fds: string[] = [];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === target) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

function socketInode(clientPort: number, serverPort: number): string | undefined {
  const want = (p: number) => p.toString(16).toUpperCase().padStart(4, "0");
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      const lp = cols[1].split(":").pop();
      const rp = cols[2].split(":").pop();
      if (lp === want(clientPort) && rp === want(serverPort) && cols[9] !== "0") return cols[9];
    }
  }
  return undefined;
}

function descendants(roots: number[]): number[] {
  const children = new Map<number, number[]>();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const list = children.get(ppid) ?? [];
      list.push(Number(d));
      children.set(ppid, list);
    } catch {
      /* 进程已退出 */
    }
  }
  const out: number[] = [];
  const queue = [...roots];
  const seen = new Set<number>();
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    queue.push(...(children.get(p) ?? []));
  }
  return out;
}
