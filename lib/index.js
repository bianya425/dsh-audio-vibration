/** dsh-audio-vibration 宿主半边：启动音频采集器、注入页面脚本、提供电平与诊断路由。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Cordis 诊断用的插件名。 */
export const name = 'audio-vibration'

/** 没有必需服务：只用事件席位与 webServer，apply 必须立刻跑。 */
export const inject = []

/** 与 package.json 的 version 保持一致。 */
export const VERSION = '1.0.0'

/** 页面轮询电平的路由。 */
export const LEVEL_ROUTE = '/dsh-audio-vibration/level'
/** 页面诊断上报的路由。 */
export const REPORT_ROUTE = '/dsh-audio-vibration/report'

/** 最近一次采集到的电平。 */
const level = { ready: false, peak: 0, rms: 0, bass: 0, bands: [], error: null, updatedAt: 0, device: '' }

let probeProcess = null
let probeBuffer = ''
let restartTimer = null
/** 宿主正在关闭：不再拉起新的探针，也不再自动重启。 */
let stopping = false

/** 只支持 Windows 的 WASAPI loopback；其它平台优雅降级为错误提示。 */
const PLATFORM = process.platform
const PLATFORM_SUPPORTED = PLATFORM === 'win32'

function trace(line) {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const file = path.join(home, 'audio-vibration-host.log')
    try {
      if (fs.statSync(file).size > 1024 * 1024) fs.writeFileSync(file, '')
    } catch {
      /* 文件还不存在 */
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* 写不进去就算了 */
  }
}

/** 把 NAudio.dll 复制到临时目录；已经复制过且大小一致就跳过，避免旧探针占用导致失败。 */
function ensureLib() {
  const dir = path.join(os.tmpdir(), 'audio-vibration-lib')
  fs.mkdirSync(dir, { recursive: true })
  const src = fileURLToPath(new URL('../runtime/NAudio.dll', import.meta.url))
  const dst = path.join(dir, 'NAudio.dll')
  try {
    if (fs.statSync(dst).size === fs.statSync(src).size) return dir
  } catch {
    /* 目标不存在 */
  }
  fs.copyFileSync(src, dst)
  return dir
}

function startProbe() {
  if (stopping) return
  if (probeProcess) return
  if (!PLATFORM_SUPPORTED) {
    level.ready = false
    level.error = '当前系统暂不支持音频采集（仅 Windows WASAPI loopback 已实现）'
    trace('probe skipped: unsupported platform ' + PLATFORM)
    return
  }
  try {
    ensureLib()
  } catch (error) {
    level.error = 'lib: ' + String(error && error.message ? error.message : error)
    trace(level.error)
    return
  }
  const script = fileURLToPath(new URL('../runtime/probe.ps1', import.meta.url))
  try {
    probeProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    level.error = 'spawn: ' + String(error && error.message ? error.message : error)
    trace(level.error)
    return
  }
  probeBuffer = ''
  trace('probe spawned pid=' + probeProcess.pid)

  probeProcess.stdout.setEncoding('utf8')
  probeProcess.stdout.on('data', (chunk) => {
    probeBuffer += chunk
    let idx
    while ((idx = probeBuffer.indexOf('\n')) >= 0) {
      const line = probeBuffer.slice(0, idx).trim()
      probeBuffer = probeBuffer.slice(idx + 1)
      if (!line) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.error) {
          level.error = String(parsed.error) + (parsed.message ? ': ' + parsed.message : '')
          trace('probe error: ' + line)
        } else if (parsed.ready) {
          level.ready = true
          level.error = null
          if (typeof parsed.device === 'string') level.device = parsed.device
          trace('probe ready device=' + level.device)
        } else if (typeof parsed.rms === 'number') {
          level.peak = typeof parsed.peak === 'number' ? parsed.peak : 0
          level.rms = parsed.rms
          level.bass = typeof parsed.bass === 'number' ? parsed.bass : 0
          level.bands = Array.isArray(parsed.bands) ? parsed.bands : []
          level.updatedAt = Date.now()
        }
      } catch {
        /* 坏行忽略 */
      }
    }
  })

  probeProcess.stderr.on('data', (chunk) => {
    trace('probe stderr: ' + String(chunk).slice(0, 300))
  })

  probeProcess.on('exit', (code) => {
    trace('probe exit code=' + code)
    probeProcess = null
    level.ready = false
    if (stopping) return
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(startProbe, 3000)
  })
}

function stopProbe(final = false) {
  if (final) stopping = true
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (probeProcess) {
    try {
      probeProcess.kill('SIGKILL')
    } catch {
      /* 已经退出了就忽略 */
    }
    probeProcess = null
  }
}

/** 读本包内的运行时文件；只允许包目录内的相对路径。 */
function readRuntime(relPath) {
  const url = new URL(`../runtime/${relPath}`, import.meta.url)
  return fs.readFileSync(url, 'utf8')
}

function json(res, status, payload) {
  try {
    if (res.writableEnded || res.destroyed) return
    const text = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
    })
    res.end(text)
  } catch {
    /* 客户端已断开 */
  }
}

/**
 * 插件主体。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 */
export function apply(ctx) {
  trace(`apply() v${VERSION} called`)
  stopping = false

  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`[${name}] ${message}`)
    } catch {
      /* 日志都不该成为失败原因 */
    }
    trace(`warn: ${message}`)
  }

  ctx.effect(() => {
    startProbe()
    return () => {
      trace('effect dispose: stopping probe')
      stopProbe(true)
    }
  })

  // 宿主只在启动时收集一次注入表，必须同步注册
  ctx.on('webserver/index-inject', (table) => {
    trace(`index-inject fired: table=${Array.isArray(table) ? 'array(' + table.length + ')' : typeof table}`)
    if (!Array.isArray(table)) return
    try {
      const css = readRuntime('vibration.css')
      const js = readRuntime('vibration.js')
      trace(`runtime read: css=${css.length}B js=${js.length}B`)
      table.push({ kind: 'style', text: css }, { kind: 'script', placement: 'body', text: js })
      trace(`pushed; table now ${table.length}`)
    } catch (error) {
      warn(`注入行生成失败，页面将回落到无竖线外观：${String(error && error.message ? error.message : error)}`)
    }
  })

  // 路由：电平查询、诊断上报
  ctx.inject(['webServer'], (child) => {
    child.effect(() => {
      const disposeLevel = child.webServer.register({
        kind: 'exact',
        path: LEVEL_ROUTE,
        handler: (req, res) => {
          json(res, 200, {
            ready: level.ready,
            peak: level.peak,
            rms: level.rms,
            bass: level.bass,
            bands: level.bands,
            error: level.error,
            supported: PLATFORM_SUPPORTED,
            platform: PLATFORM,
            device: level.device,
            age: level.updatedAt ? Date.now() - level.updatedAt : -1,
            version: VERSION,
          })
        },
      })

      const disposeReport = child.webServer.register({
        kind: 'exact',
        path: REPORT_ROUTE,
        handler: (req, res) => {
          let body = ''
          req.on('data', (chunk) => {
            if (body.length < 8000) body += chunk
          })
          req.on('end', () => {
            trace(`page-report: ${body.slice(0, 2000)}`)
            try {
              res.writeHead(204)
              res.end()
            } catch {
              /* 客户端已断开 */
            }
          })
        },
      })

      trace(`routes registered: ${LEVEL_ROUTE} ${REPORT_ROUTE}`)
      return () => {
        disposeLevel()
        disposeReport()
      }
    })
  })
}
