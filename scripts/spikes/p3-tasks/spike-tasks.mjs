// Phase 3 spike plugin (see driver.mjs), loaded into the DSH child like dsh-runtime/plugins/amb-*.mjs.
// It answers loopback HTTP requests from the driver so the driver can probe in-process services and create,
// prompt, steer, cancel, resume and inspect extra sessions. Not product code: a stand-in for P1's host->child
// control channel, and for the task decoration a real amb-tasks plugin would do on agent/created.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const name = 'spike-tasks'

const SERVICES = ['agents', 'sessions', 'sessionPersistence', 'workingDirectory', 'jobs', 'subagents', 'tools', 'systemPrompt',
  'permissionPresets', 'storageDomain', 'loader', 'sessionProjections',
  'sessionController', 'workspaceRegistry', 'agentPresets', 'schedule']

export function apply(ctx) {
  const portFile = process.env.SPIKE_PORT_FILE
  const runtime = process.env.SPIKE_RUNTIME
  if (!portFile || !runtime) return
  const llm = import(pathToFileURL(path.join(runtime, 'node_modules/@deepseek-ai/dsh-llm/lib/index.js')).href)
  const events = []
  ctx.on('agent/status', ({ agent, status }) => { events.push({ t: Date.now(), type: 'status', id: String(agent.id), status }) })
  ctx.on('session/event', (session, event) => {
    if (['turn/start', 'turn/end', 'tool/call', 'user/message'].includes(event.type)) {
      events.push({ t: Date.now(), type: event.type, id: String(session.id), source: event.data?.source?.kind, name: event.data?.name })
    }
  })

  const agentOf = (id) => ctx.get('agents')?.get(id)
  // Decorate every task session when DSH publishes it: created by this plugin, by the SDK, or resumed after a restart.
  const decorated = new WeakSet()
  ctx.on('agent/created', ({ agent }) => {
    events.push({ t: Date.now(), type: 'created', id: String(agent.id) })
    if (!String(agent.id).startsWith('task-') || decorated.has(agent)) return
    decorated.add(agent)
    agent.ctx.tools.restrict({ deny: ['present', 'ask_user_question'] })
  })
  const routes = {
    async probe() {
      await ctx.get('loader')?.await?.()
      return Object.fromEntries(SERVICES.map((s) => [s, ctx.get(s) !== undefined]))
    },
    async create({ sessionId, cwd, deny, section, reportTool, preset }) {
      fs.mkdirSync(cwd, { recursive: true })
      const presets = ctx.get('agentPresets')
      const handle = await ctx.get('agents').create({
        sessionId,
        meta: { cwd, ...(preset ? { agentPreset: preset } : {}) },
        agentOptions: { provider: 'magpie', model: 'mock-agent' },
        ...(preset && presets ? { setup: async (agentCtx) => { await presets.mount(agentCtx, preset) } } : {}),
      })
      const agent = handle.agent
      if (deny?.length && !decorated.has(agent)) agent.ctx.tools.restrict({ deny })
      if (section) agent.ctx.systemPrompt.section({ name: 'spike-task', order: 9999, text: section })
      if (reportTool) {
        agent.ctx.tools.register({
          name: 'task_report',
          description: 'Report the task state to the app.',
          parameters: { type: 'object', properties: { state: { type: 'string' }, summary: { type: 'string' } }, required: ['state'] },
          output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
          execute: async (args) => { events.push({ t: Date.now(), type: 'report', id: sessionId, ...args }); return { ok: true } },
        })
      }
      return { id: String(agent.id), cwd: await ctx.get('workingDirectory').ensure(agent), composedPreset: presets?.composedPreset?.(agent.ctx) }
    },
    async followup({ sessionId, text }) {
      const { createUserMessage } = await llm
      const agent = agentOf(sessionId)
      if (!agent) throw new Error('no agent ' + sessionId)
      const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
      agent.followup(message)
      return { messageId: message.id }
    },
    async steer({ sessionId, text }) {
      const { createUserMessage } = await llm
      const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
      agentOf(sessionId).steer(message)
      return { messageId: message.id }
    },
    async cancel({ sessionId, keepInbox }) {
      agentOf(sessionId).cancel({ kind: 'user' }, { keepInbox: !!keepInbox })
      return {}
    },
    async status({ ids }) {
      const out = {}
      for (const id of ids) {
        const a = agentOf(id)
        out[id] = a ? { status: a.status, inbox: a.inbox.nextTurn.length + a.inbox.nextStep.length, cwd: await ctx.get('workingDirectory').ensure(a) } : null
      }
      return out
    },
    async jobs({ sessionId }) {
      return (ctx.get('jobs')?.list(sessionId) ?? []).map((j) => ({ id: j.id, owner: j.owner, status: j.status }))
    },
    async resume({ sessionId }) {
      const handle = await ctx.get('agents').resume({ resumeSessionId: sessionId, agentOptions: { provider: 'magpie', model: 'mock-agent' } })
      const a = handle.agent
      return { status: a.status, inbox: a.inbox.nextTurn.length + a.inbox.nextStep.length, cwd: await ctx.get('workingDirectory').ensure(a) }
    },
    async events() { return events.splice(0) },
  }

  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const fn = routes[(req.url || '/').slice(1)]
    try {
      if (!fn) throw new Error('no route ' + req.url)
      const out = await fn(JSON.parse(body || '{}'))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out ?? {}))
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.stack ?? e) }))
    }
  })
  server.listen(0, '127.0.0.1', () => { fs.writeFileSync(portFile, String(server.address().port)) })
  ctx.on('dispose', () => server.close())
}
