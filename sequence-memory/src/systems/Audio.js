(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // Web Audio 现场合成（harness/architecture.md）：零素材零请求，Phaser 的声音管理器已关（main.js noAudio）。
    // 4a 起声音走开关体系（harness/ui.md 声音节）：通用音效（Prefs.sound，默认开）管全部声音；
    // 颜色音调（Prefs.colorTones，默认关）只管颜色类型的 lit / ok——开后按 config.COLOR_TONES
    // 一色一音高，关时回落中性音。开关入口在开局前（4c 起在设置页），
    // 局内只读开局快照（纪律 1），所以这里不直接读 Prefs 的局内分支。
    //
    // 浏览器 API 全部在函数里惰性取：Node 加载（tests/load.mjs）不抛异常，行为不测（AGENTS 测试边界）。
    // 与 Storage / Prefs 同一类：浏览器边界服务归 systems/，不碰 Phaser 也不碰 DOM
    let ctx = null;
    let master = null;

    function ensure() {
        if (ctx) { return ctx; }
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) { return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        return ctx;
    }

    // iOS 要求首次 resume() 在用户手势的同步调用栈里（harness/requirements.md #7）：
    // main.js 在 window 上挂捕获监听直接调它。监听常驻不摘——iOS 切后台再回来 ctx 会重新
    // suspended，下一次点按顺手再解锁
    function unlock() {
        const c = ensure();
        if (c && c.state === 'suspended') { c.resume(); }
    }

    // 一个音 = 振荡器 + 增益包络：6ms 淡入防咔哒，指数淡出到听不见。glide 是滑音（点错的低鸣）
    function tone(at, freq, o) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, at);
        if (o.glide) { osc.frequency.exponentialRampToValueAtTime(o.glide, at + o.dur); }
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(o.gain == null ? 0.4 : o.gain, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(at);
        osc.stop(at + o.dur + 0.02);
    }

    // 基础音效表（harness/ui.md）：UI 点击 / 呈现亮起 / 遮罩落下 / 开始复现 / 点对 / 点错 / 全对 /
    // 里程碑提速 / 音调预览。新纪录庆祝音随 5a。
    // lit / ok 收第二个参数 freq：颜色音调开时由 play 按 COLOR_TONES 喂进来，null 就是中性音
    const SOUNDS = {
        ui: function (at) { tone(at, 1400, { dur: 0.05, gain: 0.16 }); },
        lit: function (at, freq) { tone(at, freq || 660, { dur: 0.14, gain: 0.38 }); },
        veil: function (at) { tone(at, 200, { dur: 0.22, gain: 0.4, glide: 90 }); },
        recall: function (at) {
            tone(at, 520, { dur: 0.09, gain: 0.32 });
            tone(at + 0.09, 780, { dur: 0.13, gain: 0.32 });
        },
        // 里程碑提速（3a）：也是上行两音，但比 recall 更高更亮——是两个不同的事件，
        // 复用同一个音会让"该你了"和"变快了"听成一句话（harness/ui.md 动效契约）
        speed: function (at) {
            tone(at, 780, { dur: 0.08, gain: 0.3, type: 'triangle' });
            tone(at + 0.08, 1170, { dur: 0.12, gain: 0.3, type: 'triangle' });
        },
        ok: function (at, freq) { tone(at, freq || 880, { dur: 0.14, gain: 0.42, type: 'triangle' }); },
        bad: function (at) { tone(at, 160, { dur: 0.32, gain: 0.5, type: 'sawtooth', glide: 70 }); },
        clear: function (at) {
            [523.25, 659.25, 783.99, 1046.5].forEach(function (freq, i) {
                tone(at + i * 0.09, freq, { dur: 0.16, gain: 0.36, type: 'triangle' });
            });
        },
        // 打开音调开关时的预览（4a）：四色四音高完整走一遍，开关的回响就是它本身的声音。
        // 间隔比呈现节拍宽裕，四个音各自站得住、哼得出
        tones: function (at) {
            ns.COLOR_TONES.forEach(function (freq, i) {
                tone(at + i * 0.16, freq, { dur: 0.2, gain: 0.36 });
            });
        }
    };

    // 声音设置从哪读（纪律 1）：有活局读开局那一次快照（局内不回读全局设置），
    // 局外（首页 / 结算）读 Prefs 活值——开关只在开局前可改，两个分支因此不会打架
    function currentSettings() {
        const session = systems.session;
        if (session && session.active()) { return session.view().settings; }
        return systems.Prefs.get();
    }

    // opts = { type, index }：只有颜色类型的 lit / ok 吃音调，其余类型传了也不认
    function play(name, opts) {
        const sound = SOUNDS[name];
        if (!sound) { return; }
        const settings = currentSettings();
        if (!settings.sound) { return; }
        const c = ensure();
        // 还没解锁就静默跳过：suspended 时 currentTime 不走，排进去的音会在解锁那一刻挤着放
        if (!c || c.state !== 'running') { return; }
        const o = opts || {};
        const freq = (name === 'lit' || name === 'ok') && o.type === 'color' && settings.colorTones
            ? ns.COLOR_TONES[o.index] : null;
        sound(c.currentTime, freq);
    }

    systems.Audio = { unlock: unlock, play: play };
})(window.SequenceMemory = window.SequenceMemory || {});