/* dsh-audio-vibration 页面运行时：右侧竖线 + 音频条频谱，轮询宿主电平驱动生长。 */
;(function (global) {
  'use strict'

  if (global === null || typeof global !== 'object') return
  var doc = global.document
  if (!doc || typeof doc.createElement !== 'function') return
  if (global.__DSH_AUDIO_VIBRATION__ && global.__DSH_AUDIO_VIBRATION__.started) return

  var VERSION = '1.2.0'
  var STORAGE_KEY = 'dsh.audio-vibration.v1'
  var CONFIG_EVENT = 'dsh-audio-vibration-config'
  var LEVEL_URL = '/dsh-audio-vibration/level'
  var REPORT_URL = '/dsh-audio-vibration/report'
  var POLL_MS = 90

  var DEFAULTS = {
    enabled: true,
    opacity: 0.9,
    amplitude: 120,
    barCount: 32,
    barWidth: 3,
    lineLength: 100,
    gap: 2,
    lineWidth: 3,
    color: '#ffffff',
    glow: 1.2,
    gain: 1.2,
    decay: 0.08,
  }

  var api = {
    version: VERSION,
    started: true,
    state: { enabled: false, phase: 'idle', detail: '' },
  }
  global.__DSH_AUDIO_VIBRATION__ = api

  function loadConfig() {
    var out = {}
    for (var k in DEFAULTS) out[k] = DEFAULTS[k]
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          for (var key in DEFAULTS) {
            if (typeof parsed[key] === typeof DEFAULTS[key]) out[key] = parsed[key]
          }
        }
      }
    } catch (e) {
      /* 坏配置就用默认 */
    }
    return out
  }

  var config = loadConfig()

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n
  }

  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
    if (!m) return 'rgba(255,255,255,' + alpha + ')'
    var n = parseInt(m[1], 16)
    var r = (n >> 16) & 255
    var g = (n >> 8) & 255
    var b = n & 255
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
  }

  function report(kind, data) {
    try {
      if (typeof global.fetch !== 'function') return
      global
        .fetch(REPORT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: VERSION, kind: kind, data: data || null, at: Date.now() }),
          keepalive: true,
        })
        .catch(function () {
          /* 上报失败不影响功能 */
        })
    } catch (e) {
      /* 忽略 */
    }
  }

  var stemEl = null
  var barsEl = null
  var barEls = []
  var builtBarCount = 0

  function ensureStem() {
    if (stemEl && doc.documentElement && doc.documentElement.contains(stemEl)) return stemEl
    stemEl = doc.getElementById('dsh-av-stem')
    if (!stemEl) {
      stemEl = doc.createElement('div')
      stemEl.id = 'dsh-av-stem'
      if (!doc.body) return stemEl
      doc.body.appendChild(stemEl)
    }
    return stemEl
  }

  function buildBars() {
    if (!barsEl) {
      barsEl = doc.getElementById('dsh-av-bars')
      if (!barsEl) {
        barsEl = doc.createElement('div')
        barsEl.id = 'dsh-av-bars'
        if (!doc.body) return
        doc.body.appendChild(barsEl)
      }
    }
    var n = clamp(Math.round(config.barCount), 8, 999)
    if (builtBarCount === n && barEls.length === n) return
    while (barsEl.firstChild) barsEl.removeChild(barsEl.firstChild)
    barEls = []
    for (var i = 0; i < n; i++) {
      var b = doc.createElement('div')
      b.className = 'dsh-av-bar'
      barsEl.appendChild(b)
      barEls.push(b)
    }
    builtBarCount = n
    api.state.bars = n
  }

  function applyStaticStyle() {
    ensureStem()
    buildBars()
    var opa = clamp(config.opacity, 0, 1)
    if (stemEl) {
      stemEl.style.width = String(clamp(config.lineWidth, 1, 12)) + 'px'
      stemEl.style.height = String(clamp(config.lineLength, 10, 100)) + 'vh'
      stemEl.style.background = config.color
      stemEl.style.opacity = String(opa)
    }
    if (barsEl) {
      barsEl.style.width = String(clamp(config.amplitude, 0, 320)) + 'px'
      barsEl.style.gap = String(clamp(config.gap, 0, 8)) + 'px'
    }
    var barH = String(clamp(config.barWidth, 1, 24)) + 'px'
    for (var i = 0; i < barEls.length; i++) {
      barEls[i].style.height = barH
      barEls[i].style.background = config.color
      barEls[i].style.opacity = String(opa)
    }
  }

  var pollTimer = 0
  var pollBusy = false
  var rafId = 0
  var targetBands = []
  var smoothBands = []
  var peakBands = []
  var targetBass = 0
  var smoothBass = 0
  var BAND_FLOOR = 0.01

  function poll() {
    if (pollBusy) return
    pollBusy = true
    global
      .fetch(LEVEL_URL, { cache: 'no-store' })
      .then(function (res) {
        return res.json()
      })
      .then(function (data) {
        pollBusy = false
        if (!api.state.enabled) return
        if (data && data.error) {
          api.state.phase = 'error'
          api.state.detail = String(data.error)
          return
        }
        if (data && data.ready) {
          var raw = Array.isArray(data.bands) ? data.bands : []
          var gated = []
          for (var i = 0; i < raw.length; i++) {
            gated.push(raw[i] < BAND_FLOOR ? 0 : raw[i])
          }
          targetBands = gated
          targetBass = typeof data.bass === 'number' ? clamp(data.bass, 0, 1) : 0
          if (api.state.phase !== 'live') api.state.phase = 'live'
        }
      })
      .catch(function () {
        pollBusy = false
      })
  }

  function tick() {
    rafId = global.requestAnimationFrame(tick)
    if (!api.state.enabled) return

    var decay = clamp(config.decay, 0.02, 0.5)
    var attack = 0.55
    if (smoothBands.length !== targetBands.length) {
      smoothBands = targetBands.slice()
      peakBands = targetBands.slice()
    } else {
      for (var s = 0; s < targetBands.length; s++) {
        var t = targetBands[s]
        var cur = smoothBands[s]
        cur += (t - cur) * (t > cur ? attack : decay)
        smoothBands[s] = cur
        // independent peak hold: rises instantly, falls slowly, so bars release at different times
        var pk = peakBands[s]
        if (cur > pk) pk = cur
        else pk = Math.max(0, pk - 0.012)
        peakBands[s] = pk
      }
    }

    var upB = targetBass > smoothBass
    smoothBass += (targetBass - smoothBass) * (upB ? 0.4 : 0.06)

    var gain = clamp(config.gain, 0.2, 4)
    var glowVal = clamp(config.glow, 0, 3)
    var nb = smoothBands.length
    var n = barEls.length

    for (var i = 0; i < n; i++) {
      // Interpolate the spectrum across bars (like the wallpaper's lerp) so adjacent bars vary smoothly.
      var e
      if (nb > 0) {
        var pos = (i + 0.5) * nb / n
        var b0 = Math.floor(pos)
        var b1 = Math.min(nb - 1, b0 + 1)
        var frac = pos - b0
        var v0 = Math.max(smoothBands[b0], peakBands[b0] * 0.7)
        var v1 = Math.max(smoothBands[b1], peakBands[b1] * 0.7)
        e = v0 * (1 - frac) + v1 * frac
      } else {
        e = 0
      }
      var v = clamp(e * gain, 0, 1)
      var el = barEls[i]
      if (el) {
        el.style.transform = 'scaleX(' + v.toFixed(3) + ')'
        var blur = v * 18 * glowVal
        if (blur > 0.2) {
          el.style.boxShadow = '0 0 ' + blur.toFixed(1) + 'px ' + hexToRgba(config.color, 0.5)
        } else {
          el.style.boxShadow = 'none'
        }
      }
    }

    if (stemEl) {
      var stemBlur = smoothBass * 30 * glowVal
      if (stemBlur > 0.2) {
        stemEl.style.boxShadow = '0 0 ' + stemBlur.toFixed(1) + 'px ' + hexToRgba(config.color, 0.6)
      } else {
        stemEl.style.boxShadow = 'none'
      }
    }
  }

  function startPolling() {
    if (pollTimer) return
    api.state.enabled = true
    applyStaticStyle()
    try {
      doc.documentElement.setAttribute('data-av-vib', 'on')
    } catch (e) {
      /* 忽略 */
    }
    pollTimer = global.setInterval(poll, POLL_MS)
    poll()
    rafId = global.requestAnimationFrame(tick)
    report('start', { bars: barEls.length })
  }

  function stopPolling() {
    if (pollTimer) {
      global.clearInterval(pollTimer)
      pollTimer = 0
    }
    if (rafId) {
      global.cancelAnimationFrame(rafId)
      rafId = 0
    }
    api.state.enabled = false
    targetBands = []
    smoothBands = []
    targetBass = 0
    smoothBass = 0
    try {
      doc.documentElement.removeAttribute('data-av-vib')
    } catch (e) {
      /* 忽略 */
    }
    for (var i = 0; i < barEls.length; i++) {
      barEls[i].style.transform = 'scaleX(0)'
      barEls[i].style.boxShadow = 'none'
    }
    if (stemEl) {
      stemEl.style.boxShadow = 'none'
      stemEl.style.opacity = String(clamp(config.opacity, 0, 1))
    }
  }

  function applyConfig() {
    applyStaticStyle()
    if (config.enabled) startPolling()
    else stopPolling()
  }

  function boot() {
    try {
      console.info('[audio-vibration] runtime v' + VERSION)
      global.addEventListener(CONFIG_EVENT, function (event) {
        var detail = event && event.detail
        if (detail && typeof detail === 'object') {
          for (var key in DEFAULTS) {
            if (typeof detail[key] === typeof DEFAULTS[key]) config[key] = detail[key]
          }
        } else {
          config = loadConfig()
        }
        applyConfig()
        report('config-change', { amplitude: config.amplitude, barCount: config.barCount, opacity: config.opacity })
      })
      global.__audioVibrationDiag = function () {
        return {
          version: VERSION,
          phase: api.state.phase,
          enabled: api.state.enabled,
          bars: barEls.length,
          bands: smoothBands.length,
          config: config,
        }
      }
      applyConfig()
      report('boot')
    } catch (error) {
      try {
        console.error('[audio-vibration] boot failed', error)
      } catch (e) {
        /* 忽略 */
      }
      report('boot-error', { message: String((error && error.message) || error) })
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})(typeof window !== 'undefined' ? window : this)
