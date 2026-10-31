// anymodel bot image / video generation tools (MIT, part of anymodel bot).
//
// Registers media_models, media_docs, generate_image and generate_video. The agent never holds a
// Modelflare key: each call goes to the host over the loopback bridge (AMB_BRIDGE_URL / AMB_BRIDGE_TOKEN),
// which asks the user to confirm the model when needed (not the default model, a high estimated cost, an
// ambiguous request, or a bot set to always ask), calls Modelflare with this bot's key and saves the result
// under media/ in the workspace. The agent then delivers the file with the present tool. Every model has
// its own request format, so the agent reads the model's live docs with media_docs and passes the body.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'amb-media'
export const inject = ['tools']

const TEXT_OUT = {
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

export function apply(ctx) {
  const url = process.env.AMB_BRIDGE_URL
  const token = process.env.AMB_BRIDGE_TOKEN
  if (!url || !token) return
  const botId = process.env.AMB_BOT_ID ?? ''

  const run = async (op, args, exec) => {
    const res = await fetch(url + '/dsh/media', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ botId, sessionId: String(exec.agent?.session?.id ?? ''), op, args }),
      signal: exec.signal,
    })
    if (!res.ok) throw new Error(`bridge /dsh/media ${res.status}`)
    const r = await res.json()
    if (r.error) throw new Error(String(r.error))
    return { text: String(r.text ?? '') }
  }

  const CONFIRM = {
    type: 'boolean',
    description: 'true: ask the user before generating, because the request is ambiguous. false: the user named this model, so a model other than the default needs no question. Omit otherwise. A high estimated cost is always asked.',
  }

  const BODY = {
    type: 'object',
    additionalProperties: true,
    description: "Request body exactly as the model's media_docs page shows it, without model. Write local files as \"workspace:<path>\" (sent as a data URL) or \"workspace-base64:<path>\" (raw Base64, e.g. Gemini inline_data.data). Omit for a plain text-only request.",
  }

  ctx.tools.register(defineTool({
    name: 'media_models',
    description: 'List the image and video models this bot may use on Modelflare, with the default model, parameter ranges (sizes, ratios, resolutions, seconds, reference media) and reference prices. Free; call it before choosing a model.',
    parameters: {
      kind: { type: 'string', enum: ['image', 'video'], description: 'Only this kind. Omit for both.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('models', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'media_docs',
    description: "Read the live documentation page of one image or video model from docs.modelflare.dev: endpoint, exact request body, parameter table, reference-media fields and limits. Every model has its own format; read it before passing a body to generate_image or generate_video.",
    parameters: {
      model: { type: 'string', required: true, description: 'Exact model id, e.g. kling-3.0-turbo.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('docs', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate or edit an image with an image model on Modelflare. With the default model and a normal cost it generates right away; otherwise the user is asked to confirm the model first and may pick another one or cancel. The image is saved in the workspace under media/; deliver it with the present tool when the user should receive it. Write the prompt in detail (subject, style, composition, text in the image).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the image should show, in detail. Shown to the user when asked; keep it in sync with the prompt inside body.' },
      model: { type: 'string', description: 'Image model id. Omit to use the default model.' },
      confirm: CONFIRM,
      body: BODY,
      endpoint: { type: 'string', enum: ['generations', 'edits'], description: 'For OpenAI Images models only: "edits" when the docs say reference images go to /v1/images/edits. Default generations.' },
      size: { type: 'string', description: 'Optional size such as 1024x1024 for a plain request without body, Images API models only.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('image', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'generate_video',
    description: 'Generate a short video with a video model on Modelflare. With the default model and a normal cost it generates right away; otherwise the user is asked to confirm the model first and may pick another one or cancel. It can take several minutes. The video is saved in the workspace under media/; deliver it with the present tool. Only use it when the user asks for a video: video generation costs much more than images.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the video should show, in detail. Shown to the user when asked; keep it in sync with the prompt inside body.' },
      model: { type: 'string', description: 'Video model id. Omit to use the default model.' },
      confirm: CONFIRM,
      body: BODY,
      seconds: { type: 'number', description: 'Optional length in seconds for a plain request without body.' },
      size: { type: 'string', description: 'Optional size such as 1280x720 for a plain request without body.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('video', args, exec),
  }))
}
