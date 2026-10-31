// anymodel bot live system-prompt section (MIT, part of anymodel bot).
//
// The host writes this bot's section (chat rules, memory guide, the bot's name and the persona the user
// wrote) to AMB_PROMPT_FILE whenever it changes, before each turn. DSH assembles the system prompt for every
// model request and calls a section's `text` synchronously (a Promise is not awaited), so this plugin reads
// the file synchronously each time: an edited persona reaches the very next request, in running
// conversations too, without /new or restarting the agent. An unchanged file gives the same text, so the
// system prompt stays byte-identical for the provider's prefix cache.
//
// The section is the last one (after every DSH section) and is literal text (no {{variable}} interpolation:
// a persona may contain braces). Subagents get nothing from it: they do not talk to the user.
import fs from 'node:fs'

export const name = 'amb-prompt'
export const inject = ['systemPrompt']

export const SECTION = 'amb:bot'
export const ORDER = 20_000

/** Read the section text; keep the last good text when a read fails (e.g. Windows while the host replaces it). */
export function reader(file) {
  let last = ''
  return () => {
    if (!file) return ''
    try {
      last = fs.readFileSync(file, 'utf8')
    } catch (e) {
      if (e?.code === 'ENOENT') last = ''
    }
    return last
  }
}

/** Whether the assembly is for a subagent (its session names a parent session). */
export function isSubagent(context) {
  return !!context?.agent?.session?.header?.parentSession
}

export function apply(ctx) {
  const read = reader(process.env.AMB_PROMPT_FILE)
  ctx.systemPrompt.section({
    name: SECTION,
    order: ORDER,
    interpolate: false,
    text: (context) => (isSubagent(context) ? '' : read()),
  })
}
