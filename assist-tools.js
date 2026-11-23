#!/usr/bin/env node
// The helper's hands: the tools of the sphere, offered to Claude the usual way (MCP over standard input and output,
// one JSON message a line). Used by the helper in the sphere (assist.js) and by the project's chat in VS Code
// (.mcp.json). It only passes on: everything is asked of the VR Workspace server on this PC (VR_SERVER), which
// checks it. No package needed: the four requests Claude makes are answered here.
import readline from 'node:readline'

const SERVER = process.env.VR_SERVER ?? 'http://127.0.0.1:8080'
const TOOLS = [
  { name: 'sphere_settings', description: 'The settings of the VR sphere the user sits in, as they are now: each with what it is, its value and, for numbers, its range and step; also the backgrounds to choose from and whether a video is being recorded. Read this before a relative change ("darker", "a bit stronger").',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'sphere_set', description: 'Change settings of the VR sphere; it shows at once in the headset. Numbers are brought into their range. Answers with the values now in force.',
    inputSchema: { type: 'object', properties: { changes: { type: 'object', description: 'key: new value, for example {"bgDim": 40, "focusGlow": false}. The keys are those of sphere_settings.' } }, required: ['changes'], additionalProperties: false } },
  { name: 'sphere_do', description: 'Do something in the VR sphere: "record" starts or stops the video recording of what the user sees (`on`: true or false); "recenter" puts the sphere\'s middle where the user looks now; "look_around" has the user look around the room again for the head movement; "switch_off" switches VR Workspace off, after the user has confirmed it in the headset.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['record', 'recenter', 'look_around', 'switch_off'] }, on: { type: 'boolean', description: 'for "record" only' } }, required: ['action'], additionalProperties: false } },
  { name: 'sphere_marks', description: 'What the user has marked with the mouse in the helper\'s mode of the sphere: for each mark its number, its kind (a whole window, a frame around a part of it, an arrow pointing at something), the window\'s title and program, and the picture of just that place. Nothing else of the screen is ever sent. Empty when nothing is marked.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
]

async function server(path, body) { // the server's answer as JSON; its refusal as an error with its words
  const answer = await fetch(SERVER + path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }).catch(() => { throw new Error('VR Workspace is not running on this PC') })
  const text = await answer.text()
  if (!answer.ok) throw new Error(text || `the server answered ${answer.status}`)
  return text ? JSON.parse(text) : {}
}
const text = value => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
async function call(name, input) {
  if (name === 'sphere_settings') return text(await server('/assist/settings'))
  if (name === 'sphere_set') return text(await server('/assist/settings', { changes: input?.changes }))
  if (name === 'sphere_do') return text(await server('/assist/do', { action: input?.action, on: input?.on }))
  if (name === 'sphere_marks') {
    const marks = await server('/assist/marks')
    if (!marks.length) return text('Nothing is marked.')
    return marks.flatMap(m => [...text(`Mark ${m.n}: ${m.about}`), { type: 'image', data: m.png, mimeType: 'image/png' }])
  }
  throw new Error(`no tool "${name}"`)
}

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  const { id, method, params } = request
  if (id === undefined) return // a notice: nothing to answer
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vr-sphere', version: '1' } } })
  if (method === 'ping') return send({ id, result: {} })
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } })
  if (method === 'tools/call') {
    try { return send({ id, result: { content: await call(params?.name, params?.arguments) } }) } catch (e) { return send({ id, result: { content: text(e.message), isError: true } }) }
  }
  send({ id, error: { code: -32601, message: `unknown method ${method}` } })
})
