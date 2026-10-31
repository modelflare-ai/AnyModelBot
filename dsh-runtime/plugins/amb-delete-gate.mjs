// anymodel bot: recursive-delete gate for the Full Access preset (MIT, part of anymodel bot).
//
// A bot on 完全权限 runs DSH's danger-full-access sandbox mode: commands run unconfined and never
// ask to escalate. Recursive deletes are the one exception: before a shell tool runs, its command
// text goes through recursiveDelete(); a hit turns the call into a normal DSH approval request,
// which amb-bridge routes to the chat. The host loads this plugin only for full-access bots.
//
// It guards against accidents, not against a hostile model: the text is matched, never run, so
// commands built at runtime (eval "$(…)", curl … | sh) or hidden in build tools (make clean,
// npm run clean) are not seen. Scripts named on the command line are read and checked too.
// When unsure it asks: a needless prompt is cheap, a missed `rm -rf` is not.
import fs from 'node:fs'
import path from 'node:path'

export const name = 'amb-delete-gate'

/** POSIX rm 家族：-r / -R / --recursive（选项可以写在路径后面） */
const RM = new Set(['rm', 'srm', 'grm', 'gnurm'])
/** PowerShell 的 Remove-Item 及其别名（Windows 上 rm/del/rd/rmdir 都是它） */
const PS_RM = new Set(['remove-item', 'ri', 'rm', 'del', 'erase', 'rd', 'rmdir'])
/** find -exec / xargs 后面跟着就算批量删除的命令 */
const ANY_RM = new Set([...RM, ...PS_RM, 'unlink', 'shred'])
/** cmd 的 rd /s、rmdir /s、del /s、erase /s */
const CMD_RM = new Set(['rd', 'rmdir', 'del', 'erase'])
/** 本身就是递归删除的命令（出现在命令的位置上才算：npm install rimraf 不问） */
const ALWAYS = new Set(['rimraf', 'del-cli', 'deltree'])
/** 包在别的命令前面、把后面的词当命令运行的前缀 */
const WRAP = new Set(['sudo', 'doas', 'env', 'nice', 'nohup', 'time', 'timeout', 'command', 'builtin', 'exec', 'npx', 'pnpx', 'bunx', 'dlx', 'yarn', 'pnpm', 'xargs', 'parallel', '%', 'foreach-object', 'foreach'])

/** 解释器与脚本语言里的递归删除 API（在原文上匹配，不分大小写） */
const API = [
  [/\brmtree\b|\bremove_tree\b/i, 'rmtree'],                                  // Python shutil / Perl File::Path
  [/\brm_rf?\b|\bremove_dir\b|\bremove_entry(?:_secure)?\b/i, 'FileUtils.rm_r'], // Ruby
  [/\b(?:rm|rmdir)(?:Sync)?\s*\([^)]*\brecursive\b/i, 'fs.rm(…, { recursive })'], // Node
  [/\bemptyDir(?:Sync)?\s*\(/, 'emptyDir'],                                   // fs-extra
  [/\bRemoveAll\b|\bremove_dir_all\b/i, 'RemoveAll'],                         // Go / Rust
  [/\bdeleteRecursively\b|\bdeleteDirectory\b|\bcleanDirectory\b|\bforceDelete\b/i, 'deleteDirectory'], // Kotlin / Java / VB
  [/\bDirectory\s*\]?\s*(?:::|\.)\s*Delete\s*\(/i, 'Directory.Delete'],      // .NET [IO.Directory]::Delete、Directory.Delete
  [/\.Delete\s*\(\s*\$?true\s*\)/i, '.Delete($true)'],                         // DirectoryInfo.Delete($true)
]

const SCRIPT = /\.(?:sh|bash|zsh|ksh|ps1|psm1|bat|cmd|py|js|mjs|cjs|rb|pl)$/i
/** 运行脚本文件的解释器与前缀 */
const RUNS = new Set(['sh', 'bash', 'zsh', 'ksh', 'dash', 'ash', 'source', '.', 'python', 'python3', 'py', 'node', 'deno', 'bun', 'tsx', 'ruby', 'perl', 'pwsh', 'powershell', 'cmd', 'call', 'start', ...WRAP])
const DASHES = '-\u2013\u2014\u2015' // PowerShell 也把 – — ― 当作参数前缀

const base = (w) => w.toLowerCase().split(/[\\/]/).pop().replace(/\.exe$/, '')
/** PowerShell：-Recurse 的任意前缀（-r、-rec、-Recurse:$true，大小写不限）、-rf 这类 POSIX 写法、@splat（可能带着 Recurse） */
function psRecursive(w) {
  if (/^@[a-z_]\w*$/i.test(w)) return true
  if (!DASHES.includes(w[0])) return false
  const n = w.slice(1).split(':')[0].toLowerCase()
  return n.length > 0 && ('recurse'.startsWith(n) || /^[rfvdi]*r[rfvdi]*$/.test(n))
}
/** rm 的递归选项：POSIX 的 -r/-R/-rf/-fr…（getopt 也认 --r、--rec… 这样的长选项前缀），以及 PowerShell 的写法 */
function rmRecursive(w, ps) {
  if (psRecursive(w) || /^--r/i.test(w)) return true
  return !ps && /^-(?!-)[a-z0-9]*r/i.test(w)
}
/** 列文件时递归（管道后面再删 = 递归删除）：-r/-R/-Recurse、dir /s、find 的 -depth */
const listsRecursively = (w) => psRecursive(w) || /^-(?!-)[a-z]*r/i.test(w) || /^--recursive$/i.test(w) || /^\/s$/i.test(w) || /^-depth$/i.test(w)

/** 管道里这一段的命令是不是删除（跳过 % { …、xargs、sudo 这类前缀）：返回那个词 */
function deleter(words) {
  for (const w of words) {
    const b = base(w)
    if (ANY_RM.has(b) || /\.delete$/i.test(w)) return w
    if (!WRAP.has(b) && !DASHES.includes(w[0]) && !w.includes('=')) return undefined
  }
  return undefined
}

/** git 子命令：跳过 -C <dir>、-c <k=v> 这类全局选项 */
function gitSub(rest) {
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i].toLowerCase()
    if (/^(-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(w)) i++
    else if (!w.startsWith('-')) return { sub: w, at: i, args: rest.slice(i + 1).map((x) => x.toLowerCase()) }
  }
  return { sub: '', at: -1, args: [] }
}

/** pwsh -EncodedCommand <base64(UTF-16LE)>：解出来再查；解不出来的当作可疑 */
function encoded(words, i) {
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j].toLowerCase()
    if (!DASHES.includes(w[0])) continue
    const n = w.slice(1)
    if (n === 'e' || n === 'ec' || (n.length >= 2 && 'encodedcommand'.startsWith(n))) {
      const b64 = words[j + 1]
      if (!b64) return undefined
      const text = Buffer.from(b64, 'base64').toString('utf16le')
      // eslint-disable-next-line no-control-regex
      if (!text || /[\u0000-\u0008\u000e-\u001f]/.test(text)) return '-EncodedCommand'
      return recursiveDelete(text, { shell: 'ps' })
    }
  }
  return undefined
}

/** 一段管道里的一条命令（已拆成词）。返回命中的说明或 undefined。 */
function stageHit(words, ps) {
  // git rm 是 git 的子命令，归下面的 git 规则管（--cached 只动索引）；git submodule foreach 'rm -rf …' 照常查
  const gitRm = new Set()
  words.forEach((w, g) => {
    const s = base(w) === 'git' ? gitSub(words.slice(g + 1)) : undefined
    if (s?.sub === 'rm') gitRm.add(g + 1 + s.at)
  })
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].toLowerCase()
    const b = base(raw)
    const rest = words.slice(i + 1)
    if (ALWAYS.has(b) && (i === 0 || WRAP.has(base(words[i - 1])))) return b
    const viaGit = gitRm.has(i)
    if (!viaGit && RM.has(b) && rest.some((w) => rmRecursive(w, ps))) return `${b} ${rest.find((w) => rmRecursive(w, ps))}`
    if (!viaGit && PS_RM.has(b) && rest.some(psRecursive)) return `${words[i]} ${rest.find(psRecursive)}`
    // cmd：rd /s /q、del /s、rd/s/q（命令名后面直接跟开关）
    const glued = /^(rd|rmdir|del|erase)\//.exec(raw)
    if (CMD_RM.has(b) || glued) {
      const switches = [...(glued ? [raw.slice(glued[1].length)] : []), ...rest.map((w) => w.toLowerCase())]
      if (switches.some((w) => w.startsWith('/') && w.split('/').includes('s'))) return `${glued ? glued[1] : b} /s`
    }
    if (b === 'find') {
      if (rest.some((w) => w.toLowerCase() === '-delete')) return 'find -delete'
      const x = rest.findIndex((w) => /^-(exec|execdir|ok|okdir)$/i.test(w))
      if (x >= 0 && rest.slice(x + 1).some((w) => ANY_RM.has(base(w)))) return 'find -exec rm'
    }
    if ((b === 'xargs' || b === 'parallel') && rest.some((w) => ANY_RM.has(base(w)))) return `${b} rm`
    if (b === 'git') {
      const { sub, args } = gitSub(rest)
      if (sub === 'clean' && !args.some((w) => w === '--dry-run' || /^-[a-z]*n/.test(w))) return 'git clean'
      if (sub === 'rm' && args.some((w) => /^-[a-z]*r/.test(w)) && !args.includes('--cached')) return 'git rm -r'
    }
    if (b === 'rsync' && rest.some((w) => /^--del/i.test(w) || /^--remove-source-files$/i.test(w))) return 'rsync --delete'
    if (b === 'robocopy' && rest.some((w) => /^\/(mir|purge)$/i.test(w))) return 'robocopy /MIR'
    // 打包后删掉原文件
    if (b === 'tar' && rest.some((w) => /^--remove-files$/i.test(w))) return 'tar --remove-files'
    if (b === 'zip' && rest.some((w) => /^-(?!-)[a-z0-9]*m/i.test(w) || /^--move$/i.test(w))) return 'zip -m'
    if (b === 'pwsh' || b === 'powershell' || b === 'pwsh-preview') {
      const hit = encoded(words, i)
      if (hit) return hit
    }
  }
  return undefined
}

/**
 * 去掉引号与转义，把子命令、括号、数组之类的标点变成空格：嵌套的 sh -c "…"、cmd /c "…"、
 * python -c "subprocess.run(['rm', '-rf', p])" 都摊平成同一串词再查。只会多问，不会少问。
 */
function flatten(src, ps) {
  let s = String(src).replace(/\\\r?\n/g, ' ')
  s = ps ? s.replace(/`\r?\n/g, ' ').replace(/`(.)/g, '$1') : s.replace(/\\(.)/g, '$1')
  return s
    .replace(/['"\u2018\u2019\u201a\u201b\u201c\u201d\u201e^]/g, '')
    .replace(/\$\(|@\(|[(){}[\],<>`]/g, ' ')
}

/** 未加引号的变量或命令替换当 rm 的参数（rm $opts dir）：展开后可能就是 -r，问一下 */
function hiddenArgs(src) {
  for (const seg of String(src).split(/[;&|\r\n]+/)) {
    const words = seg.trim().split(/\s+/)
    const i = words.findIndex((w) => RM.has(base(w.replace(/^\\/, ''))))
    if (i >= 0 && words.slice(i + 1).some((w) => /^(\$|`)/.test(w))) return `${words[i]} ${words.slice(i + 1).find((w) => /^(\$|`)/.test(w))}`
  }
  return undefined
}

/**
 * 判断一条 shell 命令是否会递归删除。shell = 'posix'（bash 工具）或 'ps'（Windows 的 pwsh 工具）；
 * read(path) 可选，返回命令里点名的脚本文件内容（脚本里的递归删除也问）。
 * 返回命中的简短说明（例如 "rm -rf"），没有命中返回 undefined。
 */
export function recursiveDelete(command, { shell = 'posix', read } = {}) {
  const src = String(command ?? '')
  if (!src.trim()) return undefined
  const ps = shell === 'ps'
  for (const [re, what] of API) if (re.test(src)) return what
  if (!ps) {
    const hidden = hiddenArgs(src)
    if (hidden) return hidden
  }
  const flat = flatten(src, ps)
  const scripts = []
  for (const stmt of flat.split(/&&|\|\||[;&\r\n]/)) {
    const stages = stmt.split('|').map((s) => s.trim().split(/\s+/).filter(Boolean)).filter((s) => s.length)
    for (let k = 0; k < stages.length; k++) {
      const hit = stageHit(stages[k], ps)
      if (hit) return hit
      // gci -Recurse | Remove-Item、gci -r | % { $_.Delete() }：前面递归列出，后面逐个删
      const del = k > 0 ? deleter(stages[k]) : undefined
      if (del && stages.slice(0, k).some((s) => s.some(listsRecursively))) return `${stages.slice(0, k).flat().find(listsRecursively)} | ${del}`
      // 要运行的脚本：./x.sh、bash x.sh、python3 -u x.py、pwsh -File x.ps1（cat x.sh 这类只是读，不算）
      stages[k].forEach((w, i) => {
        if (SCRIPT.test(w) && (i === 0 || stages[k].slice(0, i).some((p) => RUNS.has(base(p))))) scripts.push(w)
      })
    }
  }
  if (read) {
    for (const w of scripts) {
      const text = read(w)
      if (typeof text !== 'string') continue
      const hit = recursiveDelete(text, { shell: /\.(ps1|psm1|bat|cmd)$/i.test(w) ? 'ps' : 'posix' })
      if (hit) return `${w}: ${hit}`
    }
  }
  return undefined
}

function argsOf(exec) {
  const a = exec?.arguments
  if (typeof a === 'string') {
    try {
      return JSON.parse(a)
    } catch {
      return {}
    }
  }
  return a && typeof a === 'object' ? a : {}
}

/** 读命令里点名的脚本（相对 workdir 或进程当前目录，最多 256 KB）。 */
function scriptReader(cwd) {
  return (p) => {
    try {
      const f = path.resolve(cwd, p)
      const st = fs.statSync(f)
      return st.isFile() && st.size <= 256 * 1024 ? fs.readFileSync(f, 'utf8') : undefined
    } catch {
      return undefined
    }
  }
}

export function apply(ctx) {
  if (process.env.DSH_PERMISSION_MODE !== 'danger-full-access') return
  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next()
    if (downstream?.kind !== 'allow') return downstream
    const args = argsOf(exec)
    if (typeof args.command !== 'string') return downstream
    const tool = String(exec?.name ?? '')
    const shell = /pwsh|powershell/i.test(tool) ? 'ps' : 'posix'
    // 相对路径的脚本按这次命令的目录找：workdir 参数，否则会话当前目录（working_directory 工具可以改）
    let root = process.cwd()
    try {
      const wd = ctx.get?.('workingDirectory')?.get?.(exec?.agent?.session)
      if (typeof wd === 'string' && wd) root = wd
    } catch {}
    const cwd = typeof args.workdir === 'string' && args.workdir ? path.resolve(root, args.workdir) : root
    const hit = recursiveDelete(args.command, { shell, read: scriptReader(cwd) })
    if (!hit) return downstream
    return {
      kind: 'ask',
      reason: `Recursive delete (${hit}) needs the user's approval, even with full access`,
      displayReason: { en: `Recursive delete: ${hit}`, zh: `递归删除，需要你确认（${hit}）` },
    }
  }, { prepend: true })
}
