// Phase 3 feasibility spike (evidence for docs/design/background-tasks-and-proactive.md, appendix A).
// Starts the pinned DSH the way src/agent/host.ts does (sdk profile, generated patch, replaced env) against a
// scripted Chat Completions mock, and probes what background tasks need. Not product code; never shipped.
// Usage: node scripts/spikes/p3-tasks/driver.mjs [base|schedule|schedule2|preset] [runtimeDir]
//   base      extra sessions with own folders, concurrency, per-session cancel, tool surface, job wake, restart
//   schedule  @deepseek-ai/dsh-schedule inserted under the sdk profile
//   schedule2 dsh-schedule plus dsh-workspace and dsh-api-session-controller
//   preset    dsh-agent-preset-registry and one preset, mounted on a session the plugin creates
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname)
const variant = process.argv[2] ?? 'base'
const runtime = path.resolve(process.argv[3] ?? path.join(here, '../../../dsh-runtime'))
const { DeepSeekHarness } = await import(pathToFileURL(path.join(runtime, 'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')).href)

const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '')

// ---------- scripted model ----------
const requests = []
const hung = []
function plan(messages, tools) {
  let i = messages.length - 1
  while (i >= 0 && !(messages[i].role === 'user' && /[A-Z]+-[A-Z0-9]+/.test(textOf(messages[i].content)))) i--
  const user = textOf(messages[i]?.content)
  const after = messages.slice(i + 1)
  const toolResults = after.filter((m) => m.role === 'tool').map((m) => textOf(m.content))
  const laterUser = after.filter((m) => m.role === 'user').map((m) => textOf(m.content))
  const m = /([A-Z]+)-([A-Z0-9]+)/.exec(user)
  const [kind, tag] = m ? [m[1], m[2]] : ['', '']
  if (kind === 'HANG') return { hang: true }
  if (kind === 'TOOLS') return { text: `TOOLS-${tag}<<${tools.join(',')}>>` }
  if (kind === 'PING') return { text: `PONG-${tag}` }
  const bash = (command, extra = {}) => ({ tool: { name: 'bash', args: { description: 'run', command, ...extra } } })
  if (kind === 'PWD') return toolResults.length ? { text: `PWD-${tag}<<${toolResults.join('|')}>>` } : bash(`pwd && echo hi > out-${tag}.txt && ls`)
  if (kind === 'SLOW') return toolResults.length ? { text: `SLOWDONE-${tag}` } : bash(`sleep 4; echo slow-${tag}`, { timeoutMs: 20000 })
  if (kind === 'BG') {
    if (laterUser.some((t) => /bgdone|job/i.test(t))) return { text: `SAWJOB-${tag}<<${laterUser.join('|').slice(0, 300)}>>` }
    return toolResults.length ? { text: `BGSTARTED-${tag}` } : bash(`sleep 3; echo bgdone-${tag}`, { run_in_background: true })
  }
  if (kind === 'LONGBG') return toolResults.length ? { text: `LONGBGSTARTED-${tag}` } : bash(`sleep 600`, { run_in_background: true })
  if (kind === 'REPORT') return toolResults.length ? { text: `REPORTED-${tag}` } : { tool: { name: 'task_report', args: { state: 'ready', summary: `done ${tag}` } } }
  return { text: `OK-${kind}-${tag}` }
}
const llm = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const url = req.url.split('?')[0]
  if (url.endsWith('/models')) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'mock-agent', object: 'model' }] }))
  const b = JSON.parse(raw || '{}')
  const tools = (b.tools ?? []).map((t) => t.function?.name ?? t.name)
  const step = b.tools ? plan(b.messages ?? [], tools) : { text: 'title' }
  const lastUser = textOf((b.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content).slice(0, 120)
  requests.push({ at: Date.now(), lastUser, users: (b.messages ?? []).filter((m) => m.role === 'user').map((m) => textOf(m.content).slice(0, 40)), tools, step, toolOut: (b.messages ?? []).filter((m) => m.role === 'tool').map((m) => textOf(m.content).slice(0, 200)) })
  if (step.hang) return void hung.push(res)
  if (!b.stream) return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: step.text ?? '' }, finish_reason: 'stop' }] }))
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (o) => res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: b.model, ...o })}\n\n`)
  if (step.tool) {
    send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2, 8), type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] } }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: step.text } }] })
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  }
  send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
  res.end('data: [DONE]\n\n')
})
await new Promise((r) => llm.listen(0, '127.0.0.1', r))
const llmUrl = `http://127.0.0.1:${llm.address().port}`

// ---------- DSH child, as host.ts starts it ----------
const root = fs.mkdtempSync(path.join(os.tmpdir(), `amb-p3-${variant}-`))
const home = path.join(root, 'dsh'), workspace = path.join(root, 'workspace')
fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(workspace, { recursive: true })
const portFile = path.join(home, 'spike-port')
const y = JSON.stringify
const patch = [
  '- id: llm-pi-ai', '  config:', '    providers:', '      magpie:', '        displayName: anymodel', '        api: openai-completions',
  `        baseURL: ${y(llmUrl + '/v1')}`, '        apiKeyEnv: AMB_MAGPIE_KEY', '        models:', '          - id: "mock-agent"', '            name: "mock-agent"',
  '            contextWindow: 128000', '            maxTokens: 16000',
  '- insert:', '    - id: spike-tasks', `      name: ${y(path.join(here, 'spike-tasks.mjs'))}`,
  // as host.ts: the sdk profile has neither tool by default
  '    - id: amb-tool-ask-user', "      name: '@deepseek-ai/dsh-tool-ask-user'", '    - id: amb-present', "      name: '@deepseek-ai/dsh-tool-present'",
  ...(variant === 'schedule' ? ['    - id: schedule', "      name: '@deepseek-ai/dsh-schedule'"] : []),
  ...(variant === 'schedule2' ? ['    - id: workspace', "      name: '@deepseek-ai/dsh-workspace'", '    - id: session-controller', "      name: '@deepseek-ai/dsh-api-session-controller'",
    '    - id: schedule', "      name: '@deepseek-ai/dsh-schedule'", '    - id: tool-schedule', "      name: '@deepseek-ai/dsh-tool-schedule'"] : []),
  ...(variant === 'preset' ? [
    '    - id: agent-preset-registry', "      name: '@deepseek-ai/dsh-agent-preset-registry'", '      config:', '        default: amb-task',
    '    - id: amb-task-preset', "      name: '@deepseek-ai/dsh-agent-preset'", '      config:', '        id: amb-task', '        name: amb task', '        description: spike', '        order: 90',
    '        plugins:', '          - id: time-context', "            name: '@deepseek-ai/dsh-time-context'",
  ] : []),
  '',
].join('\n')
const patchFile = path.join(home, 'amb.patch.yml')
fs.writeFileSync(patchFile, patch)
const env = {
  PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8', DSH_PERMISSION_MODE: 'workspace-write', AMB_MAGPIE_KEY: 'spike-key',
  SPIKE_PORT_FILE: portFile, SPIKE_RUNTIME: runtime,
}
const harness = () => new DeepSeekHarness({ profile: 'sdk', patches: [patchFile], dshHome: home, env, cwd: workspace, processCwd: workspace,
  provider: 'magpie', model: 'mock-agent', initializeTimeoutMs: 180000, shutdownTimeoutMs: 3000 })

async function ctl(route, body = {}) {
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100)
  const port = fs.readFileSync(portFile, 'utf8')
  const r = await fetch(`http://127.0.0.1:${port}/${route}`, { method: 'POST', body: JSON.stringify(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(`${route}: ${j.error}`)
  return j
}
/** Host-side view: every session's status notifications reach the client, also for sessions the plugin created. */
function watch(h) {
  const seen = []
  const sub = h.client.subscribe((n) => n.method === 'session.status' || (n.method === 'session.event' && ['turn/start', 'turn/end'].includes(n.params?.event?.type)))
  ;(async () => { try { for await (const n of sub) seen.push({ t: Date.now(), m: n.method, id: n.params.sessionId, s: n.params.status ?? n.params.event.type }) } catch {} })()
  return { seen, close: () => sub.close() }
}
async function until(fn, ms = 30000, label = 'condition') {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100) }
  throw new Error(`timeout waiting for ${label}`)
}
const reqFor = (re) => requests.filter((r) => re.test(r.lastUser) || r.step?.text && re.test(r.step.text))
const textFor = (re) => requests.filter((r) => r.step?.text && re.test(r.step.text)).map((r) => r.step.text)
const results = {}

let h = harness()
const t0 = Date.now()
await h.start()
log('dsh initialized in', Date.now() - t0, 'ms; variant', variant)
const w = watch(h)
results.probe = await ctl('probe')
log('services', results.probe)

if (variant === 'base') {
  const dirA = path.join(workspace, 'tasks', 'a'), dirB = path.join(workspace, 'tasks', 'b')
  // Task A: created in-process by the plugin, with tools denied, a prompt section and a host tool.
  results.createA = await ctl('create', { sessionId: 'task-a', cwd: dirA, deny: ['present', 'ask_user_question'], section: 'You are working on a background task.', reportTool: true })
  // Task B: created over the SDK the host already uses (session handle + working directory), no plugin call.
  const sb = h.session('task-b')
  results.createB = { cwd: await sb.setWorkingDirectory(dirB).catch(async (e) => { fs.mkdirSync(dirB, { recursive: true }); return sb.setWorkingDirectory(dirB) }) }
  const chat = h.session('chat-1')
  results.toolsB = (await sb.run('TOOLS-B')).finalResponse

  // 1. tool surface per session
  await ctl('followup', { sessionId: 'task-a', text: 'TOOLS-A' })
  const rChat = await chat.run('TOOLS-CHAT')
  await until(() => textFor(/TOOLS-A/).length, 30000, 'TOOLS-A')
  const toolsA = reqFor(/TOOLS-A/)[0].tools, toolsChat = reqFor(/TOOLS-CHAT/)[0].tools
  results.tools = { task: toolsA, chat: toolsChat, taskLacks: toolsChat.filter((t) => !toolsA.includes(t)), taskOnly: toolsA.filter((t) => !toolsChat.includes(t)) }
  log('tools', results.tools.taskLacks, results.tools.taskOnly, rChat.finalResponse)

  // 2. own folder per session
  await ctl('followup', { sessionId: 'task-a', text: 'PWD-A' })
  const rB = await sb.run('PWD-B')
  await until(() => textFor(/PWD-A<</).length, 30000, 'PWD-A')
  results.folders = { a: textFor(/PWD-A<</)[0], b: rB.finalResponse, aFile: fs.existsSync(path.join(dirA, 'out-A.txt')), bFile: fs.existsSync(path.join(dirB, 'out-B.txt')) }
  log('folders', results.folders)

  // 3. concurrency: two slow task turns and a chat turn at once
  const c0 = Date.now()
  await ctl('followup', { sessionId: 'task-a', text: 'SLOW-A' })
  const slowB = sb.run('SLOW-B')
  const ping = await chat.run('PING-1')
  const pingMs = Date.now() - c0
  await slowB
  await until(() => textFor(/SLOWDONE-A/).length, 30000, 'SLOW-A')
  results.concurrency = { chatReplyMs: pingMs, bothSlowDoneMs: Date.now() - c0, chat: ping.finalResponse }
  log('concurrency', results.concurrency)

  // 4. cancel one session while another works
  await ctl('followup', { sessionId: 'task-a', text: 'HANG-A' })
  const slowB2 = sb.run('SLOW-B2')
  await until(async () => (await ctl('status', { ids: ['task-a'] }))['task-a'].status === 'running', 10000, 'task-a running')
  await ctl('cancel', { sessionId: 'task-a' })
  const cancelMs = await until(async () => (await ctl('status', { ids: ['task-a'] }))['task-a'].status === 'idle', 10000, 'task-a idle after cancel')
  const b2 = await slowB2
  const ping2 = await chat.run('PING-2')
  results.cancel = { taskAIdleAfterMs: cancelMs, taskBStillFinished: b2.finalResponse, chatAfter: ping2.finalResponse }
  log('cancel', results.cancel)

  // 5. report tool registered for task-a only
  await ctl('followup', { sessionId: 'task-a', text: 'REPORT-A' })
  await until(() => textFor(/REPORTED-A/).length, 30000, 'REPORT-A')
  results.report = (await ctl('events')).filter((e) => e.type === 'report')
  log('report', results.report)

  // 6. a background job keeps the session's work alive past idle and wakes it when it ends
  const j0 = Date.now()
  await ctl('followup', { sessionId: 'task-a', text: 'BG-A' })
  await until(() => textFor(/BGSTARTED-A/).length, 30000, 'BG started')
  await until(async () => (await ctl('status', { ids: ['task-a'] }))['task-a'].status === 'idle', 10000, 'idle after BG start')
  const jobsWhileIdle = await ctl('jobs', { sessionId: 'task-a' })
  await until(() => textFor(/SAWJOB-A/).length, 30000, 'job wake')
  results.jobs = { jobsWhileIdle, wokeAfterMs: Date.now() - j0, wakeText: textFor(/SAWJOB-A/)[0]?.slice(0, 200),
    hostSawStatuses: w.seen.filter((e) => e.id === 'task-a' && e.t >= j0).map((e) => e.s) }
  log('jobs', results.jobs)

  // 7. restart: a hung turn, a queued message and a long job are in flight when the app closes DSH
  await ctl('followup', { sessionId: 'task-a', text: 'LONGBG-A' })
  await until(() => textFor(/LONGBGSTARTED-A/).length, 30000, 'long bg')
  await until(async () => (await ctl('status', { ids: ['task-a'] }))['task-a'].status === 'idle', 10000, 'idle')
  await ctl('followup', { sessionId: 'task-a', text: 'HANG-A2' })
  await until(async () => (await ctl('status', { ids: ['task-a'] }))['task-a'].status === 'running', 10000, 'running')
  await ctl('followup', { sessionId: 'task-a', text: 'QUEUED-A' })
  const before = { status: await ctl('status', { ids: ['task-a', 'task-b'] }), jobs: await ctl('jobs', { sessionId: 'task-a' }) }
  w.close()
  await h.close()
  for (const r of hung.splice(0)) r.destroy()
  fs.rmSync(portFile, { force: true })
  log('closed DSH; restarting')
  const nReq = requests.length
  h = harness()
  await h.start()
  const w2 = watch(h)
  const resumedViaPlugin = await ctl('resume', { sessionId: 'task-a' })
  const resumedB = await h.resumeSession('task-b')
  const cwdB = await resumedB.getWorkingDirectory()
  await sleep(3000)
  const after = { status: await ctl('status', { ids: ['task-a'] }), jobs: await ctl('jobs', { sessionId: 'task-a' }),
    newModelRequests: requests.slice(nReq).map((r) => r.lastUser), hostSaw: w2.seen.map((e) => `${e.id}:${e.s}`) }
  // what the resumed task remembers: ask it to list what it saw
  const rA = await (async () => { await ctl('followup', { sessionId: 'task-a', text: 'PING-AFTER' }); await until(() => textFor(/PONG-AFTER/).length, 30000, 'after'); return textFor(/PONG-AFTER/)[0] })()
  const lastReq = reqFor(/PING-AFTER/)[0]
  await ctl('followup', { sessionId: 'task-a', text: 'TOOLS-A2' })
  await until(() => textFor(/TOOLS-A2/).length, 30000, 'TOOLS-A2')
  results.toolsAfterRestart = textFor(/TOOLS-A2/)[0]
  results.createdEvents = (await ctl('events')).filter((e) => e.type === 'created').map((e) => e.id)
  results.restart = { before, resumedViaPlugin, cwdB, after, firstReplyAfterRestart: rA,
    historyHasQueued: requests.some((r) => r.at > 0 && /QUEUED-A/.test(r.lastUser)), historyAfterRestart: lastReq?.users }
  log('restart', JSON.stringify(results.restart, null, 1))
  w2.close()
}

if (variant === 'preset') {
  const dir = path.join(workspace, 'tasks', 'p')
  results.preset = await ctl('create', { sessionId: 'task-p', cwd: dir, preset: 'amb-task' })
  await ctl('followup', { sessionId: 'task-p', text: 'TOOLS-P' })
  const chat = await h.session('chat-p').run('TOOLS-PCHAT')
  await until(() => textFor(/TOOLS-P<</).length, 30000, 'TOOLS-P')
  const tp = reqFor(/TOOLS-P</)[0]?.tools ?? reqFor(/TOOLS-P$/)[0]?.tools, tc = reqFor(/TOOLS-PCHAT/)[0].tools
  results.presetTools = { sameAsChat: JSON.stringify([...tp].sort()) === JSON.stringify([...tc].sort()), presetCount: tp.length, chatCount: tc.length }
  log('preset', results.preset, results.presetTools, chat.finalResponse)
}

await h.close()
llm.close()
fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(results, null, 2))
log('done; results in', path.join(root, 'result.json'), '; stderr tail:', (h.client.stderrTail ?? []).slice(-5))
process.exit(0)
