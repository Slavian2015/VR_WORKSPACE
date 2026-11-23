#!/usr/bin/env node
// The helper's hands: the tools of the sphere, offered to Claude the usual way (MCP over standard input and output,
// one JSON message a line). Used by the helper in the sphere (assist.js) and by the project's chat in VS Code
// (.mcp.json). It only passes on: everything is asked of the VR Workspace server on this PC (VR_SERVER), which
// checks it. No package needed: the four kinds of request Claude makes are answered here.
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
  { name: 'sphere_windows', description: 'What is in the VR sphere now and where it hangs. `panels`: every panel (a monitor of the PC, or a single window) with its id, title and program; its place (yaw: degrees to the right of straight ahead, negative to the left; pitch: degrees up, negative down); how much of the view it takes (width and height, degrees); its distance (dist, metres); `hidden`, `keyboard` (it gets the keys) and `looked`: the user looked at it while speaking, which is what "this window" means when nothing is marked. `gaze`: where the user looked then. `elsewhere`: programs with a window open on the PC that is not in the sphere (sphere_open brings it). `layouts`: the names of the arrangements kept. Read this before opening or moving anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'sphere_open', description: 'Bring something into the sphere as a window. Exactly one of: `program` (the name of an installed program: a window of it already open on the PC is shown, else it is started), `link` (a web address: it opens in a browser window of its own), `file` (a path, or a name or a part of the name of a file or folder in the user\'s folders: it opens with its usual program). Waits for the window and answers with its panel, which stands where the user looks. A name that fits nothing, or several things, is answered with the names to choose from.',
    inputSchema: { type: 'object', properties: { program: { type: 'string' }, link: { type: 'string' }, file: { type: 'string' } }, additionalProperties: false } },
  { name: 'sphere_place', description: 'Move or resize a panel of the sphere. `panel`: its id from sphere_windows. Any of: `yaw` and `pitch` (degrees, as in sphere_windows), `width` (the degrees of the view it takes; its height follows), `dist` (metres: nearer looks larger, as a real screen does), `beside` (stand next to another panel, in line with it, a small gap between; it takes the place of yaw and pitch). Answers with the panel as it is now.',
    inputSchema: { type: 'object', properties: { panel: { type: 'string' }, yaw: { type: 'number' }, pitch: { type: 'number' }, width: { type: 'number' }, dist: { type: 'number' },
      beside: { type: 'object', properties: { panel: { type: 'string' }, side: { type: 'string', enum: ['left', 'right', 'above', 'below'] } }, required: ['panel', 'side'], additionalProperties: false } }, required: ['panel'], additionalProperties: false } },
  { name: 'sphere_close', description: 'Close a window of the sphere, or take it out of the sphere. `panel`: its id from sphere_windows. `how`: "close" closes the window on the PC (the user is asked in the headset first; its program may ask about unsaved work), "out" only takes it out of the sphere, it stays open on the PC. Not for monitors.',
    inputSchema: { type: 'object', properties: { panel: { type: 'string' }, how: { type: 'string', enum: ['close', 'out'] } }, required: ['panel', 'how'], additionalProperties: false } },
  { name: 'sphere_type', description: 'Type text into a window of the sphere, where its cursor is (it is pasted, so any language and signs work). `panel`: its id from sphere_windows. `text`: plain text, 160 characters at most (longer: several calls). `enter`: true presses Enter after it, to send a message or run a command. The user is shown the text in the headset and must confirm it first.',
    inputSchema: { type: 'object', properties: { panel: { type: 'string' }, text: { type: 'string' }, enter: { type: 'boolean' } }, required: ['panel', 'text'], additionalProperties: false } },
  { name: 'sphere_layout', description: 'Arrangements of the sphere kept under names. "save" remembers under `name` where every panel stands now and which program each window is. "restore" brings that back: windows of those programs that are open come into the sphere at their places, programs that are not running are started (documents inside them are not opened again). "list" names what is kept. "forget" removes one.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['save', 'restore', 'list', 'forget'] }, name: { type: 'string', description: 'for all but "list"' } }, required: ['action'], additionalProperties: false } },
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
  const asked = { sphere_windows: '/assist/windows', sphere_open: '/assist/open', sphere_place: '/assist/place', sphere_close: '/assist/close', sphere_type: '/assist/type', sphere_layout: '/assist/layout' }[name]
  if (asked) return text(await server(asked, name === 'sphere_windows' ? undefined : input ?? {}))
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
