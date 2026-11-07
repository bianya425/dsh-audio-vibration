/** dsh-audio-vibration 浏览器半边：设置页「右侧律动竖线」。手写 __ModuleLoader__ bundle，无构建步骤。 */

window.__ModuleLoader__.load({
  id: 'dsh-audio-vibration',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect

    var STORAGE_KEY = 'dsh.audio-vibration.v1'
    var CONFIG_EVENT = 'dsh-audio-vibration-config'
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

    function loadConfig() {
      var out = {}
      for (var k in DEFAULTS) out[k] = DEFAULTS[k]
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY)
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

    function saveConfig(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: next }))
      } catch (e) {
        /* 存不上就算了 */
      }
    }

    var CSS = [
      '.av-set{padding:2px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary,#e6e9ef);}',
      '.av-set-card{border:1px solid var(--dsw-alias-border-l3,#3a3f4a);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:13px;}',
      '.av-set-row{display:flex;align-items:center;justify-content:space-between;gap:14px;}',
      '.av-set-title{color:var(--dsw-alias-label-primary,#e6e9ef);}',
      '.av-set-hint{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11.5px;line-height:1.5;margin-top:2px;}',
      '.av-set input[type=range]{width:190px;accent-color:#ffffff;}',
      '.av-set input[type=checkbox]{width:16px;height:16px;accent-color:#ffffff;cursor:pointer;}',
      '.av-set input[type=color]{width:46px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l3,#3a3f4a);border-radius:6px;background:none;cursor:pointer;}',
      '.av-set-val{min-width:48px;text-align:right;color:#c7d2e0;font-variant-numeric:tabular-nums;}',
      '.av-set-swatch{display:inline-flex;align-items:center;gap:8px;}',
      '.av-set-swatch i{width:18px;height:18px;border-radius:50%;display:inline-block;border:1px solid rgba(255,255,255,.25);}',
      '.av-set-note{font-size:11.5px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#8b93a1);}',
      '.av-set-sep{height:1px;background:var(--dsw-alias-border-l3,#3a3f4a);opacity:.5;}',
      '.av-set-warn{border:1px solid rgba(255,140,120,.45);background:rgba(255,120,100,.08);color:#ffb4a8;border-radius:10px;padding:10px 13px;font-size:12px;line-height:1.6;}',
    ].join('')

    function Row(props) {
      return h('div', { className: 'av-set-row' }, props.children)
    }

    function Label(props) {
      return h(
        'div',
        null,
        h('div', { className: 'av-set-title' }, props.title),
        props.hint ? h('div', { className: 'av-set-hint' }, props.hint) : null,
      )
    }

    function Slider(props) {
      return h(
        Row,
        null,
        h(Label, { title: props.title, hint: props.hint }),
        h('input', {
          type: 'range',
          min: props.min,
          max: props.max,
          step: props.step,
          value: props.value,
          onChange: function (event) {
            props.onChange(parseFloat(event.target.value))
          },
        }),
        h('span', { className: 'av-set-val' }, props.text(props.value)),
      )
    }

    function Section() {
      var initial = useState(loadConfig())
      var cfg = initial[0]
      var setCfg = initial[1]

      var platformState = useState(null)
      var platform = platformState[0]
      var setPlatform = platformState[1]

      useEffect(function () {
        fetch('/dsh-audio-vibration/level', { cache: 'no-store' })
          .then(function (res) {
            return res.json()
          })
          .then(function (data) {
            if (data && typeof data.supported === 'boolean') {
              setPlatform({ supported: data.supported, platform: data.platform || '', error: data.error || '' })
            }
          })
          .catch(function () {
            /* 拿不到就不提示 */
          })
      }, [])

      function update(patch) {
        var next = Object.assign({}, cfg, patch)
        setCfg(next)
        saveConfig(next)
      }

      var platformWarn =
        platform && platform.supported === false
          ? h(
              'div',
              { className: 'av-set-warn' },
              '当前系统（' + (platform.platform || '非 Windows') + '）不支持音频采集——',
              '采集器目前只有 Windows（WASAPI loopback）实现。设置会保留，换到 Windows 上会自动生效。',
            )
          : null

      return h(
        'div',
        { className: 'av-set' },
        platformWarn,
        h(
          'div',
          { className: 'av-set-card' },
          h(
            Row,
            null,
            h(Label, { title: '启用音频条', hint: '让页面最右边随电脑正在播放的声音长出频谱条，静音时收成一根竖线' }),
            h('input', {
              type: 'checkbox',
              checked: !!cfg.enabled,
              onChange: function (event) {
                update({ enabled: event.target.checked })
              },
            }),
          ),
          h('div', { className: 'av-set-sep' }),
          h(Slider, {
            title: '透明度',
            hint: '竖线本身的透明度（0 完全透明，1 完全不透明）',
            min: 0,
            max: 1,
            step: 0.01,
            value: cfg.opacity,
            text: function (v) {
              return Math.round(v * 100) + '%'
            },
            onChange: function (v) {
              update({ opacity: v })
            },
          }),
          h(Slider, {
            title: '振幅 / 最大长度',
            hint: '声音最强时音频条向左生长的像素长度，越大越明显',
            min: 0,
            max: 320,
            step: 4,
            value: cfg.amplitude,
            text: function (v) {
              return v + 'px'
            },
            onChange: function (v) {
              update({ amplitude: v })
            },
          }),
          h(Slider, {
            title: '条数',
            hint: '频谱条数量（对应音频频率段数），最高 999',
            min: 8,
            max: 999,
            step: 1,
            value: cfg.barCount,
            text: function (v) {
              return String(Math.round(v)) + ' 条'
            },
            onChange: function (v) {
              update({ barCount: Math.round(v) })
            },
          }),
          h(Slider, {
            title: '条宽度',
            hint: '每根频谱条的粗细（高度）',
            min: 1,
            max: 24,
            step: 1,
            value: cfg.barWidth,
            text: function (v) {
              return v + 'px'
            },
            onChange: function (v) {
              update({ barWidth: v })
            },
          }),
          h(Slider, {
            title: '条间距',
            hint: '相邻音频条之间的空隙',
            min: 0,
            max: 8,
            step: 1,
            value: cfg.gap,
            text: function (v) {
              return v + 'px'
            },
            onChange: function (v) {
              update({ gap: v })
            },
          }),
          h(Slider, {
            title: '竖线粗细',
            hint: '最右边那根竖线的宽度',
            min: 1,
            max: 12,
            step: 1,
            value: cfg.lineWidth,
            text: function (v) {
              return v + 'px'
            },
            onChange: function (v) {
              update({ lineWidth: v })
            },
          }),
          h(Slider, {
            title: '竖线长度',
            hint: '竖线占屏幕高度的百分比，从中间向上下两侧生长/缩短',
            min: 10,
            max: 100,
            step: 1,
            value: cfg.lineLength,
            text: function (v) {
              return v + '%'
            },
            onChange: function (v) {
              update({ lineLength: v })
            },
          }),
          h(
            Row,
            null,
            h(Label, { title: '颜色', hint: '默认白色，可以换成任意颜色' }),
            h('input', {
              type: 'color',
              value: cfg.color,
              onChange: function (event) {
                update({ color: event.target.value })
              },
            }),
            h('span', { className: 'av-set-swatch' }, h('i', { style: { background: cfg.color } })),
          ),
          h('div', { className: 'av-set-sep' }),
          h(Slider, {
            title: '泛光强度',
            hint: '振动时竖线周围光晕的强度',
            min: 0,
            max: 3,
            step: 0.1,
            value: cfg.glow,
            text: function (v) {
              return Math.round(v * 100) + '%'
            },
            onChange: function (v) {
              update({ glow: v })
            },
          }),
          h(Slider, {
            title: '灵敏度',
            hint: '对音量的响应强度，越大越容易满幅振动',
            min: 0.2,
            max: 4,
            step: 0.1,
            value: cfg.gain,
            text: function (v) {
              return v.toFixed(1) + 'x'
            },
            onChange: function (v) {
              update({ gain: v })
            },
          }),
          h(Slider, {
            title: '回落速度',
            hint: '声音停止后音频条收回的速度，越小尾迹越长越顺滑',
            min: 0.02,
            max: 0.5,
            step: 0.01,
            value: cfg.decay,
            text: function (v) {
              return v.toFixed(2)
            },
            onChange: function (v) {
              update({ decay: v })
            },
          }),
        ),
        h(
          'div',
          { className: 'av-set-note' },
          '音频由宿主侧 WASAPI loopback 采集（默认输出设备），只取频谱与低频，不录音、不上传。',
          '如果音频条没反应，先播放点声音试试；声音要经过默认播放设备。',
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(function () {
        var id = 'dsh-audio-vibration-set-styles'
        if (document.getElementById(id) === null) {
          var style = document.createElement('style')
          style.id = id
          style.textContent = CSS
          document.head.appendChild(style)
        }
        return function () {
          var el = document.getElementById(id)
          if (el !== null && el.parentNode !== null) el.parentNode.removeChild(el)
        }
      }, 'dsh-audio-vibration: styles')

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'audio-vibration',
            order: 48,
            label: function () {
              return '右侧律动竖线'
            },
          },
          function () {
            return h(Section)
          },
        )
      })
    }

    module.exports = {
      name: 'audio-vibration',
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
