// The helper in the sphere: Claude with a set of tools ("hands") for the sphere itself, asked by voice or text.
// What it does shows as a card low in the view (server.js keeps the card; the pages draw it).
//
// Claude is the Claude Code program run without its window (`claude -p`), under the user's own sign-in: no key and
// no package to add. It gets no tools of its own (no files, no shell), only ours: assist-tools.js, which asks this
// server (/assist/...). The same tools serve the project's chat in VS Code (.mcp.json).
//
// Only what was marked is ever sent: a picture leaves this PC when the user has marked a place in the helper's mode
// and Claude asks for the marks.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LAYOUT_SPEC } from './app/params.js'

// What the helper may read and change: the settings of the sphere's own blocks (app/main.js, BLOCKS). For Claude.
export const SETTINGS = {
  sharpen: 'Sharpness of the text in windows, %',
  focusGlow: 'A light around the window that has the keyboard: on or off',
  hideMonitors: 'Hide the monitors and leave only single windows: on or off',
  sixDof: 'Head movement from the phone camera (leaning toward a window brings it nearer): on or off',
  leanGain: 'How strongly leaning brings a window nearer, times',
  passthrough: 'The phone camera in place of the background scene: on or off',
  camBelow: 'The phone camera shows where one looks further down than this many degrees, to see the keyboard and the hands; 0: off',
  camKeep: 'Keep the phone camera open all the time: on or off',
  camFov: 'How wide the camera picture is shown, degrees',
  camShiftX: 'The camera picture moved right (+) or left (-), degrees',
  camShiftY: 'The camera picture moved up (+) or down (-), degrees',
  bg: 'The background of the sphere: one of `backgrounds`',
  bgDim: 'Darkening of the background, %',
  bgBlur: 'Blur of the background, %',
}
// The settings as Claude is told them. all: every setting with its value (params.js, complete)
export function settingsTold(all, backgrounds) {
  return { settings: Object.entries(SETTINGS).map(([key, about]) => {
    const spec = LAYOUT_SPEC[key]
    return { key, about, value: all[key], ...(spec && { min: spec[1], max: spec[2], step: spec[3] }) }
  }), backgrounds }
}
// What Claude asked to change, as values that may be kept: numbers brought into their range and onto their step.
// Throws with words Claude can act on.
export function settingsPatch(changes, backgrounds) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw new Error('`changes` must be an object: { key: value }')
  const patch = {}
  for (const [key, value] of Object.entries(changes)) {
    const spec = LAYOUT_SPEC[key]
    if (!(key in SETTINGS)) throw new Error(`There is no setting "${key}". The settings: ${Object.keys(SETTINGS).join(', ')}`)
    if (spec) {
      if (!Number.isFinite(value)) throw new Error(`"${key}" takes a number from ${spec[1]} to ${spec[2]}`)
      patch[key] = +(Math.round(Math.min(spec[2], Math.max(spec[1], value)) / spec[3]) * spec[3]).toFixed(4)
    } else if (key === 'bg') {
      if (!backgrounds.includes(value)) throw new Error(`"bg" takes one of: ${backgrounds.join(', ')}`)
      patch.bg = value
    } else if (typeof value !== 'boolean') throw new Error(`"${key}" takes true or false`)
    else patch[key] = value
  }
  return patch
}

// The Claude Code program: named in VR_CLAUDE, or `claude` where programs are looked for, or the one that came
// with the VS Code extension (the newest). null: there is none.
export function claudeProgram(env = process.env, home = os.homedir()) {
  if (env.VR_CLAUDE) return env.VR_CLAUDE
  for (const dir of (env.PATH ?? '').split(':').filter(Boolean)) if (fs.existsSync(path.join(dir, 'claude'))) return path.join(dir, 'claude')
  const folder = path.join(home, '.vscode/extensions')
  const found = !fs.existsSync(folder) ? [] : fs.readdirSync(folder).filter(name => name.startsWith('anthropic.claude-code-'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(name => path.join(folder, name, 'resources/native-binary/claude')).filter(file => fs.existsSync(file))
  return found.at(-1) ?? null
}

const SYSTEM = `Ты голосовой помощник внутри VR Workspace. Человек сидит в очках виртуальной реальности, вокруг него сфера с окнами его компьютера. Он говорит или показывает мышью, ты делаешь.

Твои руки это инструменты sphere_*: настройки сферы, её действия и места, которые человек пометил мышью. Других инструментов у тебя нет: файлы, программы и окна тебе пока недоступны, так и скажи, если просят о них.

Как работать:
- Просьбу выполняй сразу. Переспрашивай, только если без ответа нельзя.
- Слова получены распознаванием речи, в них бывают ошибки: угадывай смысл.
- Для просьб вроде «темнее» или «чуть сильнее» сначала прочитай настройки, потом меняй заметным шагом (примерно на пятую часть диапазона), если шаг не назван.
- Если сказано, что человек пометил места, посмотри их через sphere_marks и отвечай о них.

Ответ покажут маленькой карточкой перед глазами: одна короткая фраза по-русски без разметки. Скажи, что сделано, с новым значением, если менял число. Объяснение по картинке: до трёх коротких фраз.`

// What a tool call is, in words for the card
const DOING = {
  mcp__sphere__sphere_settings: () => 'Смотрю настройки',
  mcp__sphere__sphere_set: input => `Меняю: ${Object.keys(input?.changes ?? {}).join(', ') || 'настройки'}`,
  mcp__sphere__sphere_do: input => ({ record: 'Запись видео', recenter: 'Центрирую', look_around: 'Запускаю осмотр комнаты', switch_off: 'Выключение' })[input?.action] ?? 'Делаю',
  mcp__sphere__sphere_marks: () => 'Смотрю помеченное',
}

// One request. said: the words; marks: how many places are marked; before: the last exchanges, [{ said, answer }];
// server: this server's address for the tools; told(text): what Claude is doing now. model: Sonnet unless told
// otherwise (the user's choice, 2026-11-23: two seconds faster than Opus on the stand, the same result for commands). Returns { done: a promise of
// the answer (rejected with words for the card), stop() }.
export function ask({ said, marks = 0, before = [], server, tools, program = claudeProgram(), model = process.env.VR_ASSIST_MODEL ?? 'claude-sonnet-5-5' }, told = () => {}) {
  if (!program) return { done: Promise.reject(new Error('Не нашёл программу Claude Code на этом компьютере')), stop() {} }
  const prompt = [
    ...before.map(e => `Раньше человек сказал: «${e.said}». Ты ответил: «${e.answer}».`),
    marks ? `Человек пометил мышью мест: ${marks}. Посмотри их через sphere_marks.` : '',
    said ? `Человек говорит: «${said}»` : 'Человек ничего не сказал, только пометил. Коротко объясни, что на помеченном.',
  ].filter(Boolean).join('\n')
  const config = { mcpServers: { sphere: { command: process.execPath, args: [tools], env: { VR_SERVER: server } } } }
  const cwd = path.join(os.tmpdir(), 'vr-assist') // not the project's folder: its own notes and rules are not the helper's
  fs.mkdirSync(cwd, { recursive: true })
  const child = spawn(program, ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(config),
    '--allowedTools', ...Object.keys(DOING), '--setting-sources', '', '--system-prompt', SYSTEM, '--no-session-persistence', '--model', model, '--effort', 'low'],
  { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let rest = '', errors = '', answer, failed
  const done = new Promise((resolve, reject) => {
    const limit = setTimeout(() => { failed = 'Claude не ответил за минуту'; child.kill() }, 60000)
    child.stdout.setEncoding('utf8') // whole letters: a Cyrillic one may be cut in two between two pieces
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', text => { errors = (errors + text).slice(-400) })
    child.stdout.on('data', text => {
      const lines = (rest + text).split('\n')
      rest = lines.pop()
      for (const line of lines.filter(Boolean)) {
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.type === 'assistant') for (const part of message.message?.content ?? []) if (part.type === 'tool_use') told(DOING[part.name]?.(part.input) ?? 'Делаю')
        if (message.type === 'result') message.is_error ? failed = String(message.result || 'Claude ответил ошибкой').slice(0, 200) : answer = String(message.result ?? '').trim()
      }
    })
    child.on('error', e => { clearTimeout(limit); reject(new Error(`Claude не запустился: ${e.message}`)) })
    child.on('exit', () => {
      clearTimeout(limit)
      if (answer !== undefined && !failed) return resolve(answer)
      if (!failed && errors) console.log('the helper: Claude said on its error output:', errors.trim())
      reject(new Error(failed ?? 'Claude не ответил'))
    })
  })
  return { done, stop: () => { failed = 'Остановлено'; child.kill() } }
}
