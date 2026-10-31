// anymodel bot background tasks (MIT, part of anymodel bot).
//
// The host creates one DSH session per background task over the SDK (`task-<id>`, its own folder as working
// directory) and owns tasks, runs and delivery. This plugin decorates those sessions on agent/created, which also
// fires for sessions resumed after a restart:
//   - denies the chat-only tools (present, ask_user_question and the task tools; only registered names, since
//     tools.restrict throws on unknown ones),
//   - adds the task rules (AMB_TASK_RULES, written by the host) as the last system-prompt section,
//   - registers task_report, which reports the task's state to the host (needs_you carries one question for the
//     user; the host asks it and hands the answer back as the session's next input),
//   - refuses every tool call once the host has stopped the task.
// Chat sessions get task_start / task_message / task_list and rule_create / rule_update; subagents get none of them.
//
// Rule sessions (`rule-<rule>-<run>`, one fresh session per run of a standing rule, 3d) are decorated from the host's
// answer to /dsh/task-config (the host owns the mode): the denied tools (observe denies everything that acts), the rule
// section, a rule variant of task_report (done with or without a message, failed, progress; no needs_you) and the
// session's sandbox (observe: read-only; act: at most workspace-write), which amb-permission applies before every tool
// call through a shared per-session map. Subagents of a rule session inherit its config. If the host cannot be
// reached the session fails closed: read-only and every tool refused.
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
export const CHAT_TOOLS = ['task_start', 'task_message', 'task_list', 'rule_create', 'rule_update']
/** Tools a task session never gets (filtered to registered names before tools.restrict). */
export const TASK_DENY = ['present', 'ask_user_question', ...CHAT_TOOLS]
/** Shared with amb-permission: sessionId → DSH permission preset for rule sessions (and their subagents). */
export const PRESETS = Symbol.for('amb.session.presets')
export const SECTION = 'amb:task'
/** After the bot's section (amb:bot, 20000): the task rules win over the chat rules. */
export const ORDER = 20_100

const SETTLE_MAX_MS = Number(process.env.AMB_TASK_SETTLE_MS) > 0 ? Number(process.env.AMB_TASK_SETTLE_MS) : 30 * 60_000
const WATCH_MS = 1_000
const live = (status) => status === 'running' || status === 'stopping'

export const isTask = (id) => /^task-/.test(String(id ?? ''))
export const isRule = (id) => /^rule-/.test(String(id ?? ''))
/** Rule session when the host cannot be reached: read-only, every tool refused (fail closed). */
const RULE_FALLBACK = { mode: 'observe', deny: [], denyPrefix: [], section: '', permission: 'read-only', offline: true }

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
  /** rule sessions and their subagents: id → the host's config for the run */
  const ruleConfigs = new Map()
  const presets = (globalThis[PRESETS] ??= new Map())

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
        anytime: { type: 'boolean', description: 'true only when the user asked to be told the moment it is done, even at night. Otherwise a result that is ready during their quiet hours waits until morning.' },
      },
      output: TEXT_OUT,
      execute: tool('start'),
    }))
    ctx.tools.register(defineTool({
      name: 'task_message',
      description: 'Pass the user\'s message to one of their background tasks when they refer to it or answer its question: a working task sees it at its next step, a finished or waiting one resumes with it.',
      parameters: {
        task: { type: 'string', required: true, description: 'Task id or part of its title.' },
        text: { type: 'string', required: true, description: 'The message, in the user\'s words.' },
      },
      output: TEXT_OUT,
      execute: tool('message'),
    }))
    ctx.tools.register(defineTool({
      name: 'task_list',
      description: 'List this chat\'s background tasks and rules with their state and latest result.',
      parameters: {},
      output: TEXT_OUT,
      execute: tool('list'),
    }))
    ctx.tools.register(defineTool({
      name: 'rule_create',
      description: 'Set up a standing rule the user asks for: a recurring check (kind check; it tells the user only when it matters, and starts in observe mode, only recording what it would say) or a fixed reminder (kind remind: sends message at the time). Confirm in one sentence.',
      parameters: {
        title: { type: 'string', required: true, description: 'Short, e.g. 看 X 价格.' },
        instruction: { type: 'string', required: true, description: 'The user\'s words, verbatim.' },
        schedule: { type: 'string', required: true, description: 'Local time: once YYYY-MM-DD HH:MM | daily HH:MM | weekdays HH:MM | weekly mon,thu HH:MM | every 30m | cron M H DOM MON DOW' },
        kind: { type: 'string', enum: ['check', 'remind'] },
        message: { type: 'string', description: 'remind: the line to send.' },
      },
      output: TEXT_OUT,
      execute: tool('rule_create'),
    }))
    ctx.tools.register(defineTool({
      name: 'rule_update',
      description: 'Change a rule of this chat when the user asks: mode act (results are sent), observe (only records) or off; new instruction or schedule; or delete.',
      parameters: {
        rule: { type: 'string', required: true, description: 'Rule id or part of its title.' },
        mode: { type: 'string', enum: ['observe', 'act', 'off'] },
        instruction: { type: 'string' },
        schedule: { type: 'string' },
        delete: { type: 'boolean' },
      },
      output: TEXT_OUT,
      execute: tool('rule_update'),
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
    description: 'Report this background task\'s state to the app. done: finished. failed: you cannot finish it. For both, message is the one line the user receives (at most 300 characters, in their language): the result and where it is; files are files to send them. needs_you: only the user can decide; the app asks them question, and their answer is your next message. progress is recorded, never sent. After done, failed or needs_you, end your turn.',
    parameters: {
      state: { type: 'string', required: true, enum: ['progress', 'needs_you', 'done', 'failed'] },
      summary: { type: 'string', required: true, description: 'What you did and found, for the record (not sent to the user).' },
      message: { type: 'string', description: 'For done and failed: the one line for the user.' },
      files: { type: 'array', items: { type: 'string' }, description: 'Paths of files to send to the user, relative to your folder.' },
      question: { type: 'string', description: 'For needs_you: one short question.' },
      options: { type: 'array', items: { type: 'string' }, description: 'For needs_you: choices, if any.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => host('/dsh/task-report', { sessionId: sessionOf(exec), ...args }, exec.signal),
  })

  const ruleReportTool = (mode) => defineTool({
    name: 'task_report',
    description: `Report this check to the app. done: finished; message is the one line for the user (at most 300 characters, in their language) only when they should hear about it${mode === 'observe' ? ' (observe mode: it is only recorded)' : ''}; leave it out to stay quiet. failed: you could not check, with the reason. progress is recorded, never sent. Then end your turn.`,
    parameters: {
      state: { type: 'string', required: true, enum: ['progress', 'done', 'failed'] },
      summary: { type: 'string', required: true, description: 'What you checked and found, for the record.' },
      message: { type: 'string', description: 'For done: the one line for the user, or nothing.' },
      ...(mode === 'observe' ? { would: { type: 'string', description: 'What you would have done if you could act.' } } : {}),
    },
    output: TEXT_OUT,
    execute: (args, exec) => host('/dsh/task-report', { sessionId: sessionOf(exec), ...args }, exec.signal),
  })

  /** The host's config for a rule run (mode, denied tools, section, sandbox); fail closed when it cannot be reached. */
  async function ruleConfig(id) {
    if (!call) return RULE_FALLBACK
    try {
      const r = await call('/dsh/task-config', { botId, sessionId: id }, AbortSignal.timeout(10_000))
      if (r?.error || r?.kind !== 'rule') throw new Error(String(r?.error ?? 'not a rule session'))
      return { mode: r.mode === 'act' ? 'act' : 'observe', deny: r.deny ?? [], denyPrefix: r.denyPrefix ?? [], section: String(r.section ?? ''), permission: r.permission === 'workspace-write' ? 'workspace-write' : 'read-only' }
    } catch (e) {
      ctx.logger?.warn?.(`amb-tasks: no config for rule session ${id}: ${e?.message ?? e}`)
      return RULE_FALLBACK
    }
  }

  /** Deny the rule's tools (exact names; computer use by prefix) and pin its sandbox; the same for its subagents. */
  function applyRule(agent, id, cfg, root) {
    ruleConfigs.set(id, { ...cfg, root })
    presets.set(id, cfg.permission)
    // the guard first: if anything below fails, the session is still refused what it must not do
    agent.ctx.tools.guard?.((exec) => {
      if (cfg.offline) return 'The app cannot be reached, so this check cannot run. End your turn.'
      if (stopped.has(root)) return 'This check was stopped. End your turn.'
      const name = String(exec?.name ?? exec?.tool?.name ?? '')
      if (cfg.denyPrefix.some((p) => name.startsWith(p)) || cfg.deny.includes(name)) return 'This tool is not available while running a rule.'
      return undefined
    })
    const deny = known([...new Set([...TASK_DENY, ...cfg.deny])])
    if (deny.length) agent.ctx.tools.restrict({ deny })
  }

  // ---------- decorate task sessions (created over the SDK, or resumed after a restart) ----------
  const decorated = new WeakSet()
  ctx.on('agent/created', async ({ agent }) => {
    if (!agent || decorated.has(agent)) return
    decorated.add(agent)
    const id = String(agent.id ?? '')
    const parent = agent.session?.header?.parentSession
    try {
      if (isRule(id)) {
        const cfg = await ruleConfig(id)
        applyRule(agent, id, cfg, id)
        if (cfg.section) agent.ctx.systemPrompt?.section({ name: SECTION, order: ORDER, interpolate: false, text: () => cfg.section })
        if (call && !cfg.offline) agent.ctx.tools.register(ruleReportTool(cfg.mode))
      } else if (parent && ruleConfigs.has(String(parent))) {
        // a subagent of a rule session (or of its subagent): same sandbox and denied tools
        const cfg = ruleConfigs.get(String(parent))
        applyRule(agent, id, cfg, cfg.root)
      } else if (isTask(id)) {
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
    ctx.on('agent/disposed', ({ agent }) => {
      const id = String(agent?.id ?? '')
      unwatch(id)
      ruleConfigs.delete(id)
      presets.delete(id)
    })
    ctx.on('dispose', () => {
      for (const id of [...watching.keys()]) unwatch(id)
      delete handlers['task-quiet']
      delete handlers['task-stop']
    })
  } catch {}
}
