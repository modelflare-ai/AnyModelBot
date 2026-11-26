// anymodel bot: permission gate for catalog bots (MIT, part of anymodel bot).
//
// A catalog bot only gets what its bot.json declares. The host loads this plugin only for catalog bots;
// a bot the user made never sees it.
//   AMB_BOT_DENY_TOOLS: tools whose permission was not declared. Always refused.
//   AMB_BOT_ASK_TOOLS:  tools whose permission was declared but which reach outside the bot's folder.
//                       The first use asks the user through the normal approval card. A tool counts as
//                       granted only once it actually ran, so a refusal asks again next time.
// Connected accounts and web search are also left out of the plugin list, and on Linux commands run
// without a network namespace, so this is the backstop for tool calls.
import fs from 'node:fs'
import path from 'node:path'

export const name = 'amb-bot-gate'

const list = (v) => {
  try {
    const a = JSON.parse(v || '[]')
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

export function apply(ctx) {
  const denied = new Set(list(process.env.AMB_BOT_DENY_TOOLS))
  const asked = new Set(list(process.env.AMB_BOT_ASK_TOOLS))
  if (!denied.size && !asked.size) return
  const file = path.join(process.env.HOME || '.', '.amb-bot-granted.json')
  let granted = new Set()
  try {
    granted = new Set(list(fs.readFileSync(file, 'utf8')))
  } catch {}
  const toolOf = (exec) => String(exec?.name ?? '')

  ctx.on('tools/pre-execute', async (exec, next) => {
    const tool = toolOf(exec)
    if (denied.has(tool)) return { kind: 'deny', reason: `This bot did not declare the permission for ${tool}` }
    const downstream = await next()
    if (downstream?.kind !== 'allow' || !asked.has(tool) || granted.has(tool)) return downstream
    return {
      kind: 'ask',
      reason: `First use of ${tool}: this bot declared the permission, confirm with the user`,
      displayReason: { en: `First time this bot uses ${tool}`, zh: `这个 Bot 第一次使用 ${tool}，需要你确认`, 'zh-TW': `這個機器人第一次使用 ${tool}，需要你確認` },
    }
  }, { prepend: true })

  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    const tool = toolOf(exec)
    if (asked.has(tool) && !granted.has(tool)) {
      granted.add(tool)
      try {
        fs.writeFileSync(file, JSON.stringify([...granted]))
      } catch {}
    }
    return result
  })
}
