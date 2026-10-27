// anymodel bot ⇄ DSH bridge plugin (MIT, part of anymodel bot).
//
// Loaded into the dsh child via a profile patch. The npm 0.2.1-rc.4 SDK protocol does not forward
// approval or ask-user requests to SDK clients, so this plugin answers the `approval/request` and
// `user-questions/request` waterfalls by asking the anymodel bot main process over a loopback HTTP
// bridge (URL + per-launch token in AMB_BRIDGE_URL / AMB_BRIDGE_TOKEN; DSH's shell-env does not pass
// these to tool processes). Any bridge failure fails closed: approvals become 'unavailable'
// (treated as rejection by DSH) and questions defer to the next answerer.
export const name = 'amb-bridge'

const POLL_MS = 25_000

function bridge() {
  const url = process.env.AMB_BRIDGE_URL
  const token = process.env.AMB_BRIDGE_TOKEN
  if (!url || !token) return undefined
  return async (path, body, signal) => {
    const res = await fetch(url + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`bridge ${path} ${res.status}`)
    return res.json()
  }
}

function sessionIdOf(agent) {
  return agent?.session?.id ?? agent?.sessionId ?? agent?.id
}

function reasonText(req) {
  const d = req.displayReason
  if (d && typeof d === 'object') {
    const t = d['zh-CN'] ?? d.zh ?? d.en ?? Object.values(d).find((v) => typeof v === 'string')
    if (t) return String(t)
  } else if (typeof d === 'string' && d) return d
  return req.reason ? String(req.reason) : undefined
}

async function ask(call, kind, payload, signal) {
  const { id } = await call('/dsh/ask', { kind, botId: process.env.AMB_BOT_ID ?? '', ...payload }, signal)
  const onAbort = () => { void call('/dsh/cancel', { id }).catch(() => {}) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) return { cancelled: true }
      const r = await call('/dsh/wait', { id, timeoutMs: POLL_MS }, signal)
      if (r.done) return r
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

// ---------- read fence ----------
// DSH's workspace-write sandbox fences writes only. The host keeps its own secrets (SQLite DB with
// channel tokens, magpie keys) under the data dir, so the in-process file tools must not read there.
// AMB_DENY_READ / AMB_ALLOW_READ are JSON arrays of absolute roots (allow wins).
function roots(name) {
  try {
    const v = JSON.parse(process.env[name] || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.startsWith('/') || /^[A-Za-z]:[\\/]/.test(x)) : []
  } catch {
    return []
  }
}
function under(p, root) {
  if (typeof p !== 'string') return false
  const norm = (x) => x.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(p), b = norm(root)
  return a === b || a.startsWith(b + '/')
}
export function readDenied(path, deny = roots('AMB_DENY_READ'), allow = roots('AMB_ALLOW_READ')) {
  return deny.some((r) => under(path, r)) && !allow.some((r) => under(path, r))
}
// Content reads only: metadata probes (stat/lstat of ancestors for .git, AGENTS.md…) must keep working.
const READ_METHODS = ['readText', 'streamText', 'readBytes', 'readByteRange', 'listDir']

function fenceFs(fs) {
  const deny = roots('AMB_DENY_READ')
  if (!fs || !deny.length) return () => {}
  const allow = roots('AMB_ALLOW_READ')
  const restore = []
  const check = (target) => {
    const key = target?.targetKey ?? target?.hostPath ?? target?.displayPath ?? target
    if (readDenied(String(key ?? ''), deny, allow)) {
      const err = new Error(`cannot read "${target?.displayPath ?? key}": file access denied (host data directory)`)
      err.code = 'FS_SANDBOX_DENIED'
      throw err
    }
  }
  for (const m of READ_METHODS) {
    const orig = fs[m]
    if (typeof orig !== 'function') continue
    const wrapped = function (target, ...rest) {
      check(target)
      return orig.call(this, target, ...rest)
    }
    try {
      fs[m] = wrapped
      restore.push(() => { try { delete fs[m] } catch {} })
    } catch {}
  }
  return () => restore.forEach((f) => f())
}

export function apply(ctx) {
  if (typeof ctx.inject === 'function') {
    ctx.inject(['fs'], (scope) => {
      const undo = fenceFs(scope.fs)
      scope.on?.('dispose', undo)
    })
  }

  const call = bridge()
  if (!call) return

  ctx.on('approval/request', async (req, next) => {
    try {
      const r = await ask(call, 'approval', {
        sessionId: String(sessionIdOf(req.agent) ?? ''),
        toolName: String(req.toolName ?? ''),
        callId: req.callId ? String(req.callId) : undefined,
        reason: reasonText(req),
      }, req.signal)
      if (r.cancelled) return 'cancelled'
      return r.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
    } catch {
      return req.signal?.aborted ? 'cancelled' : 'unavailable'
    }
  })

  ctx.on('user-questions/request', async (req, next) => {
    try {
      const r = await ask(call, 'question', {
        sessionId: String(sessionIdOf(req.agent) ?? ''),
        callId: req.wait?.callId ? String(req.wait.callId) : undefined,
        questions: (req.questions ?? []).map((q) => ({
          id: String(q.id), question: String(q.question ?? ''), detail: q.detail, header: q.header,
          options: Array.isArray(q.options) ? q.options.map((o) => ({ label: String(o.label), description: o.description })) : undefined,
          multiSelect: !!q.multiSelect,
        })),
      }, req.signal)
      if (r.answer && Array.isArray(r.answer.answers)) return r.answer
    } catch {}
    return next()
  })
}
