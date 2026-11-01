/**
 * 宿主写进 DSH 主目录 skills/ 的技能说明（SKILL.md），由 anymodel bot 编写。
 */

/** Cua Driver 后端的技能说明（工具来自 trycua/cua 的 cua-driver，MIT）。 */
export const CUA_SKILL = `---
name: computer-use
description: Operate native desktop apps on this computer (read windows, click, type, press keys, scroll, drag) through the bundled Cua Driver. Use when the user asks you to do something in a GUI application on their computer.
---

# Computer Use (Cua Driver)

Tools are named \`mcp__computer-use__<tool>\`. Actions run automatically; no approval is needed unless this bot is set to ask before input actions (then wait for the user's answer).

## Loop
1. Find the target: \`list_windows\` (or \`list_apps\`), or start one with \`launch_app\`.
2. Read it narrowly: \`get_window_state({pid, window_id, query:"<what you need>"})\`. Rows look like \`[N] role "label"\`; the element token for row N is \`<snapshot_id>:N\` (e.g. "s0000002a:11"), never a bare number.
3. Act with the token on the same window: \`click\`, \`type_text\`, \`set_value\`, \`press_key\`, \`hotkey\`, \`scroll\`, \`drag\`, \`invoke_menu\`. Prefer \`run_steps({steps:[{tool,args},...], observe:{}})\` to act and see what changed in one call.
4. Verify at checkpoints with \`verify_state\` or a targeted \`get_window_state\` (use \`since:"latest"\` for just the changes). Use pixel coordinates only for surfaces missing from the accessibility tree, from a fresh screenshot of the same window.

## Rules
- Screenshots are for you to look at. Do not send them to the user unless they ask; if they do, save the image into the workspace and present that file.
- Only apps installed on this computer are in scope; if a call says the app or resource is outside the capability manifest, tell the user instead of looking for a workaround.
- Do not type passwords, payment details or other secrets unless the user explicitly gave them for this task. Do not confirm purchases, deletions or messages to other people without the user asking for exactly that.
- On Linux, reading window contents needs AT-SPI; on Wayland only the foreground window can be driven. On macOS the app needs Accessibility and Screen Recording permission; if \`check_permissions\` reports them missing, tell the user how to grant them.
`;

/**
 * 生图 / 生视频的技能说明：不含 Key、不让代理自己调接口，参数格式以 Modelflare 文档为准。
 * 什么时候先问用户由宿主决定（manager.ts mediaAsk：花费高或设成每次都问）；代理自己不问，按最合理的理解直接生成。
 */
export const MEDIA_SKILL = `---
name: media
description: Generate or edit images and generate videos with Modelflare image and video models through the media_models, media_docs, generate_image and generate_video tools. Use when the user asks to draw, create, edit or restyle a picture, animate an image, or make a video.
---

# Images and videos (Modelflare)

You have no Modelflare key and must not call the API yourself (no curl, no scripts): the tools call it with this bot's key. Every generation costs the user money.

## When the user is asked first
The app generates right away. It asks the user to confirm the model first only when the estimated cost is high (above $0.5: an expensive model, a long or high-resolution video, many images) or this bot is set to always ask.
Do not ask about the subject, style, purpose or model yourself: if they are not spelled out, make the most reasonable interpretation, generate it, and say in one line what you chose.

## Steps
1. \`media_models\` (kind \`image\` or \`video\`) lists the models this bot may use, the default one, their parameter ranges and reference prices. Use the default unless the user named a model or the request needs something the default cannot do (a reference image, a ratio or length it does not support).
2. Plain text-to-image or text-to-video with default settings: call \`generate_image\` / \`generate_video\` with a detailed \`prompt\` only.
3. Anything else (ratio, resolution, size, length, quality, audio, reference images, first/last frames, editing an image): call \`media_docs\` for the chosen model, then pass \`body\` in exactly the format its page shows, without \`model\`. Every family is different (for example Seedance uses \`content[]\`, Kling \`contents\` and \`settings\`, Wan \`input\` and \`parameters\`, Gemini \`contents[].parts[]\` with \`generationConfig\`), so never reuse field names from another model's page. For OpenAI Images models whose page sends references to \`/v1/images/edits\`, also pass \`endpoint: "edits"\`. Keep \`prompt\` the same as the prompt inside \`body\`: the user sees \`prompt\` when asked.
4. Reference media: a file in the workspace is written as \`"workspace:media/x.png"\` (sent as a data URL) or \`"workspace-base64:media/x.png"\` (raw Base64, e.g. Gemini \`inline_data.data\`), up to 20 MB each. A public https URL can be used as is. Models marked 必须带参考素材 (image-to-video, reference-to-video) only work with references; many models accept reference videos only as public URLs, see the docs. Images and files the user sends in chat are saved in the workspace under \`inbox/\`, and the message shows where (for example \`[图片 inbox/20261031-143012-ab12cd.jpg]\`), so write such an image as \`"workspace:inbox/20261031-143012-ab12cd.jpg"\`. If you have no file or link for a reference, ask the user for one.
5. The tool result says what happened:
   - Generated: the file is under \`media/\`; deliver it with \`present\` and say in one line which model made it.
   - The user picked another model while you had passed a \`body\`: read that model's page with \`media_docs\`, rewrite \`body\` for it and call again with \`model\` set to it. That call is not confirmed again.
   - The user answered something else: adjust as they said and call again.
   - Cancelled or not confirmed in time: nothing was generated or charged; do not retry on your own.
6. Videos take minutes and cost much more than images: only make a video when the user asks for one, and do not generate extra variants unless asked.

## Errors
- 这把 Key 不能用这个模型 (model_not_found): this account cannot use that model; pick another one from \`media_models\`.
- Any other 4xx names the problem: fix the body according to the model's page instead of sending the same request again. If the balance is empty, tell the user to top up on Modelflare.
`;
