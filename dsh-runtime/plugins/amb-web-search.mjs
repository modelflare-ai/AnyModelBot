// anymodel bot web search provider (MIT, part of anymodel bot).
//
// Registers the "amb" search provider in DSH's web seam (ctx.web). The patch written by the host selects it with
// web.searchProvider, so DeepSeek's own provider (it needs a DeepSeek API key the app never has) is never picked.
// web_search keeps its DSH tool, schema and result card; each query goes to the host over the loopback bridge
// (AMB_BRIDGE_URL / AMB_BRIDGE_TOKEN), which searches with the app's network settings: free engines by default, or
// the search API the user set up. The agent process holds no search key.
import { WebError } from '@deepseek-ai/dsh-web'

export const name = 'amb-web-search'
export const inject = ['web']

/** Shown to the model when the host could not search; nothing here points at settings the model cannot change. */
const UNAVAILABLE = 'Web search is temporarily unavailable. If you know a relevant page, open it directly with web_fetch.'

const text = (v) => (typeof v === 'string' && v.length > 0 ? v : undefined)

export function apply(ctx) {
  const url = process.env.AMB_BRIDGE_URL
  const token = process.env.AMB_BRIDGE_TOKEN
  const botId = process.env.AMB_BOT_ID ?? ''

  const aborted = (signal, cause) => new WebError('web search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? cause })

  ctx.web.registerSearchProvider({
    id: 'amb',
    available: () => true,
    async search(request, signal) {
      if (signal?.aborted) throw aborted(signal)
      if (!url || !token) throw new WebError(UNAVAILABLE, 'WEB_PROVIDER_UNAVAILABLE')
      let reply
      try {
        const res = await fetch(url + '/dsh/search', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ botId, query: request.query, maxResults: request.maxResults }),
          signal,
        })
        if (!res.ok) throw new Error(`bridge /dsh/search ${res.status}`)
        reply = await res.json()
      } catch (error) {
        if (signal?.aborted) throw aborted(signal, error)
        throw new WebError(UNAVAILABLE, 'WEB_PROVIDER_ERROR', { cause: error })
      }
      if (reply?.error === 'aborted') throw aborted(signal)
      if (reply?.error) throw new WebError(UNAVAILABLE, 'WEB_PROVIDER_ERROR')
      const sources = (Array.isArray(reply?.sources) ? reply.sources : [])
        .filter((s) => s && typeof s.url === 'string' && s.url.length > 0)
        .map((s) => ({
          url: s.url,
          ...(text(s.title) ? { title: s.title } : {}),
          ...(text(s.snippet) ? { snippet: s.snippet } : {}),
          ...(text(s.publishedAt) ? { publishedAt: s.publishedAt } : {}),
        }))
      return { sources, truncated: reply?.truncated === true }
    },
  })
}
