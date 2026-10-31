// anymodel bot background tasks (MIT, part of anymodel bot).
//
// The host creates one DSH session per background task over the SDK (`task-<id>`, its own folder as working
// directory) and owns tasks, runs and delivery. This plugin decorates those sessions on agent/created, which also
// fires for sessions resumed after a restart:
//   - denies the chat-only tools (present, ask_user_question and the task tools; only registered names, since
//     tools.restrict throws on unknown ones),
//   - adds the task rules (AMB_TASK_RULES, written by the host) as the last system-prompt section,
//   - registers task_report, which reports the task's state to the host,
//   - refuses every tool call once the host has stopped the task.
// Chat sessions get task_start / task_message / task_list; subagents get none of the task tools.
//
// Settling: when a task session goes idle the host asks `task-quiet` over the control channel (amb-control hands
// the ops it does not know to this plugin). A session that still owns running background jobs or subagents is not
// quiet; the plugin then watches it and posts /dsh/task-settled once it is idle with nothing running and nothing
// queued for it, or stops its jobs AMB_TASK_SETTLE_MS (30 minutes) after its last turn and says which. `task-stop`
// cancels the turn, its subagents and every job the session owns.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'amb-tasks'
export const inject = ['tools']

/** Shared with amb-control: control-channel ops this plugin answers. */
export const HANDLERS = Symbol.for('amb.control.handlers')
export const CHAT_TOOLS = ['task_start', 'task_message', 'task_list']
/** Tools a task session never gets (filtered to registered names before tools.restrict). */
export const TASK_DENY = ['present', 'ask_user_question', 'rule_create', ...CHAT_TOOLS]
export const SECTION = 'amb:task'
/** After the bot's section (amb:bot, 20000): the task rules win over the chat rules. */
export const ORDER = 20_100

const SETTLE_MAX_MS = Number(process.env.AMB_TASK_SETTLE_MS) > 0 ? Number(process.env.AMB_TASK_SETTLE_MS) : 30 * 60_000
const WATCH_MS = 1_000
const live = (status) => status === 'running' || status === 'stopping'

export const isTask = (id) => /^task-/.test(String(id ?? ''))

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

const TEXT_OUT = {
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

export function apply(ctx) {
  const call = bridge()
  const botId = process.env.AMB_BOT_ID ?? ''
  const rules = process.env.AMB_TASK_RULES ?? ''
  /** task sessions the host stopped: every tool call is refused */
  const stopped = new Set()
  /** task sessions being watched until they are quiet: id → { since, timer } */
  const watching = new Map()

  const agents = () => ctx.get('agents')
  const jobs = () => ctx.get('jobs')
  const sessionOf = (exec) => String(exec?.agent?.session?.id ?? exec?.agent?.id ?? '')

  const host = async (path, body, signal) => {
    if (!call) throw new Error('the app is not reachable')
    const r = await call(path, { botId, ...body }, signal)
    if (r?.error) throw new Error(String(r.error))
    return { text: String(r?.text ?? '') }
  }

  // ---------- chat sessions: start, message and list background tasks ----------
  if (call) {
    const tool = (op) => (args, exec) => host('/dsh/task-tool', { sessionId: sessionOf(exec), op, args }, exec.signal)
    ctx.tools.register(defineTool({
      name: 'task_start',
      description: 'Start a background task in its own session and folder; the user keeps chatting and the result is sent to this chat when done. Use it for work that clearly needs more than a few minutes or many steps (build, research, a report), or when the user asks for it in the background (后台做); not for what you can answer now, or when they want it done here (前台做). Then tell the user in one sentence what runs in the background; do not do the work yourself.',
      parameters: {
        title: { type: 'string', required: true, description: 'Short title in the user\'s language.' },
        brief: { type: 'string', required: true, description: 'What to do and what result to give, at most 1,500 characters. The user\'s words and the recent chat are added automatically.' },
      },
      output: TEXT_OUT,
      execute: tool('start'),
    }))
    ctx.tools.register(defineTool({
      name: 'task_message',
      description: 'Pass the user\'s message to one of their background tasks when they refer to it: a working task sees it at its next step, a finished one resumes with it.',
      parameters: {
        task: { type: 'string', required: true, description: 'Task id or part of its title.' },
        text: { type: 'string', required: true, description: 'The message, in the user\'s words.' },
      },
      output: TEXT_OUT,
      execute: tool('message'),
    }))
    ctx.tools.register(defineTool({
      name: 'task_list',
      description: 'List this chat\'s background tasks with their state and latest result.',
      parameters: {},
      output: TEXT_OUT,
      execute: tool('list'),
    }))
  }

  const known = (names) => {
    const tools = ctx.get('tools') ?? ctx.tools
    return names.filter((n) => {
      try {
        return tools.get(n) !== undefined
      } catch {
        return false
      }
    })
  }

  const reportTool = () => defineTool({
    name: 'task_report',
    description: 'Report this background task\'s state to the app. done: the task is finished. failed: you cannot finish it. For both, message is the one line the user receives (at most 300 characters, in their language): the result and where it is; files are files to send them. progress records progress and is never sent. After done or failed, end your turn.',
    parameters: {
      state: { type: 'string', required: true, enum: ['progress', 'done', 'failed'], description: 'done, failed, or progress.' },
      summary: { type: 'string', required: true, description: 'What you did and found, for the record (not sent to the user).' },
      message: { type: 'string', description: 'For done and failed: the one line for the user.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Paths of files to send to the user, relative to your folder.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => host('/dsh/task-report', { sessionId: sessionOf(exec), ...args }, exec.signal),
  })

  // ---------- decorate task sessions (created over the SDK, or resumed after a restart) ----------
  const decorated = new WeakSet()
  ctx.on('agent/created', ({ agent }) => {
    if (!agent || decorated.has(agent)) return
    decorated.add(agent)
    const id = String(agent.id ?? '')
    try {
      if (isTask(id)) {
        const deny = known(TASK_DENY)
        if (deny.length) agent.ctx.tools.restrict({ deny })
        if (rules) agent.ctx.systemPrompt?.section({ name: SECTION, order: ORDER, interpolate: false, text: () => rules })
        if (call) agent.ctx.tools.register(reportTool())
        agent.ctx.tools.guard?.(() => (stopped.has(id) ? 'This background task was stopped by the user. Do not continue; end your turn.' : undefined))
      } else if (agent.session?.header?.parentSession) {
        // subagents (of chats and of tasks) do not start or manage tasks
        const deny = known(CHAT_TOOLS)
        if (deny.length) agent.ctx.tools.restrict({ deny })
      }
    } catch (e) {
      ctx.logger?.warn?.(`amb-tasks: could not decorate ${id}: ${e?.message ?? e}`)
    }
  })

  // ---------- settling and stop (control-channel ops) ----------
  function descendants(agent) {
    const registry = agents()
    const out = []
    const walk = (parent) => {
      for (const a of registry?.list?.() ?? []) {
        if (a !== parent && registry.isOwnedBy?.(a.id, parent)) {
          out.push(a)
          walk(a)
        }
      }
    }
    walk(agent)
    return out
  }
  const runningJobs = (id) => (jobs()?.list(id) ?? []).filter((j) => j.owner === id && live(j.status))
  const queued = (agent) => {
    try {
      return (agent.inbox?.nextTurn?.length ?? 0) + (agent.inbox?.nextStep?.length ?? 0)
    } catch {
      return 0
    }
  }
  /** idle, no inbox, no running job or subagent */
  const quiet = (agent) => agent.status === 'idle' && !queued(agent) && !runningJobs(String(agent.id)).length && !descendants(agent).some((a) => a.status === 'running')

  async function killJobs(id, why) {
    const registry = jobs()
    const list = runningJobs(id)
    const waits = list.map((j) => registry.wait(j.id, 5_000, id).catch(() => undefined))
    for (const j of list) try { registry.kill(j.id, id, why) } catch {}
    await Promise.all(waits)
    return list.map((j) => String(j.description ?? j.command ?? j.id))
  }

  function unwatch(id) {
    const w = watching.get(id)
    if (w) clearTimeout(w.timer)
    watching.delete(id)
  }

  /** Watch a task session until it is quiet twice in a row (a finished job wakes it a moment later), then report. */
  function watch(id) {
    if (watching.has(id)) return
    const w = { since: Date.now(), calm: 0, timer: undefined }
    watching.set(id, w)
    const tick = async () => {
      if (watching.get(id) !== w) return
      const agent = agents()?.get(id)
      let killedJobs = []
      if (agent && agent.status !== 'idle') {
        w.since = Date.now()
        w.calm = 0
      } else if (agent && !quiet(agent)) {
        w.calm = 0
        if (Date.now() - w.since < SETTLE_MAX_MS) return void (w.timer = setTimeout(tick, WATCH_MS))
        killedJobs = await killJobs(id, 'the task stopped waiting for it')
        for (const a of descendants(agent)) try { a.cancel({ kind: 'parent' }) } catch {}
      } else if (agent && ++w.calm < 2) return void (w.timer = setTimeout(tick, WATCH_MS))
      if (agent && agent.status !== 'idle') return void (w.timer = setTimeout(tick, WATCH_MS))
      unwatch(id)
      await call?.('/dsh/task-settled', { botId, sessionId: id, killedJobs }).catch(() => {})
    }
    w.timer = setTimeout(tick, WATCH_MS)
  }

  const handlers = (globalThis[HANDLERS] ??= {})
  handlers['task-quiet'] = async ({ sessionId }) => {
    const id = String(sessionId)
    const agent = agents()?.get(id)
    if (!agent || quiet(agent)) return { quiet: true }
    watch(id)
    return { quiet: false, jobs: runningJobs(id).map((j) => String(j.id)) }
  }
  handlers['task-stop'] = async ({ sessionId }) => {
    const id = String(sessionId)
    stopped.add(id)
    unwatch(id)
    const agent = agents()?.get(id)
    if (!agent) return { running: false }
    for (const child of descendants(agent)) try { child.cancel({ kind: 'parent' }) } catch {}
    try { agent.cancel({ kind: 'user' }, { keepInbox: false }) } catch {}
    const killed = await killJobs(id, 'stopped by the user').catch(() => [])
    return { running: true, killed }
  }

  try {
    ctx.on('agent/disposed', ({ agent }) => unwatch(String(agent?.id ?? '')))
    ctx.on('dispose', () => {
      for (const id of [...watching.keys()]) unwatch(id)
      delete handlers['task-quiet']
      delete handlers['task-stop']
    })
  } catch {}
}
