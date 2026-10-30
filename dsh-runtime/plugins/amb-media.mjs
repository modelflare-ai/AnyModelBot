// anymodel bot image / video generation tools (MIT, part of anymodel bot).
//
// Registers generate_image and generate_video. The agent never holds a Modelflare key: each call goes
// to the host over the loopback bridge (AMB_BRIDGE_URL / AMB_BRIDGE_TOKEN), which calls Modelflare with
// this bot's key and saves the result under media/ in the workspace. The agent then delivers the file
// with the present tool.
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

  ctx.tools.register(defineTool({
    name: 'generate_image',
    description: 'Generate an image from a text description with an image model on Modelflare. The image is saved in the workspace under media/; deliver it with the present tool when the user should receive it. Write the prompt in detail (subject, style, composition, text in the image).',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the image should show, in detail.' },
      model: { type: 'string', description: 'Image model id. Omit to use the first one this bot may use.' },
      size: { type: 'string', description: 'Optional size such as 1024x1024, for models on the Images API.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('image', args, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'generate_video',
    description: 'Generate a short video from a text description with a video model on Modelflare. It can take several minutes. The video is saved in the workspace under media/; deliver it with the present tool. Only use it when the user asks for a video: video generation costs much more than images.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the video should show, in detail.' },
      model: { type: 'string', description: 'Video model id. Omit to use the first one this bot may use.' },
      seconds: { type: 'number', description: 'Optional length in seconds, if the model supports it.' },
      size: { type: 'string', description: 'Optional size such as 1280x720, if the model supports it.' },
    },
    output: TEXT_OUT,
    execute: (args, exec) => run('video', args, exec),
  }))
}
