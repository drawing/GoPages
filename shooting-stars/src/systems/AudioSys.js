(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const systems = ns.systems = ns.systems || {};

    // Web Audio 现场合成零素材（harness/architecture.md），Phaser 声音管理器已关（main.js noAudio），
    // 这里是全项目唯一出声口。与 Storage 同一类：浏览器边界服务归 systems/，浏览器 API 全部在
    // 函数里惰性取，Node 加载（tests/load.mjs）不抛异常。声音本身不进测试（AGENTS 验证边界）。
    // 一个事件（CONFIG.AUDIO 的一行）= 一份共用参数 + 可选的 voices 数组，一层一个声源；
    // 合成只有三种料：振荡器（可滑音）、白噪声（可滤波扫频）、LFO（颤音加在包络上）
    class AudioSys {
        constructor(settings) {
            // 6c 起音量/静音归 Settings（settings 键唯一写者），这里只读活值 + 转发 setter，
            // 不再自己 persist——否则设置面板写 reducedMotion/strict 会被这边的两字段整份覆盖
            this.settings = settings || systems.settings();
            this.ctx = null;
            this.master = null;
            this.voices = [];
            this.noise = null;
            // 有没有发生过用户手势（unlock 置起）。手势之前连 AudioContext 都不建：建了也是 suspended、
            // play 一样静默跳过，还会在控制台留一条 "AudioContext was not allowed to start" 的警告——
            // 而标题音阶恰好就在刷新后第一次进菜单（那时还没有任何手势）触发
            this.gestured = false;
        }

        get volume() { return this.settings.volume; }
        get muted() { return this.settings.muted; }

        ensure() {
            if (this.ctx) { return this.ctx; }
            const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (!AC) { return null; }
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.muted ? 0 : this.volume;
            this.master.connect(this.ctx.destination);
            return this.ctx;
        }

        // iOS 要求首次 resume() 在用户手势的同步调用栈里：main.js 在 window 上挂捕获监听直接调它。
        // 监听常驻不摘——切后台再回来 ctx 会重新 suspended，下一次点按顺手再解锁
        unlock() {
            this.gestured = true;
            this.ensure();
            this.resume();
        }

        // 6d 挂起恢复：回前台时 main.js 的 visibilitychange 也调它（桌面浏览器切后台会自动挂起，
        // 回来不必先点一下才出声）。不伪造手势——没解锁过的不建 ctx。iOS 除 suspended 外还有
        // interrupted（来电 / 切后台），凡非 running 非 closed 都 resume，不枚举状态名
        resume() {
            const ctx = this.ctx;
            if (!this.gestured || !ctx) { return; }
            if (ctx.state !== 'running' && ctx.state !== 'closed') { ctx.resume(); }
        }

        setVolume(value) {
            this.settings.set('volume', value);
            this.applyGain();
        }

        setMuted(value) {
            this.settings.set('muted', value);
            this.applyGain();
        }

        // 渐变而不是瞬变：拖动音量时 master 直改会出 zipper 噪声
        applyGain() {
            if (!this.master) { return; }
            const target = this.muted ? 0 : this.volume;
            this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
        }

        // name 取 CONFIG.AUDIO 的键（也就是 STAR_TYPES 的 sound / armSound 那两个字段读的值）。
        // opts.step 只给带 scale 的事件读音阶：命中传 combo - 1（连击越高音越高）、
        // 倒计时传第几步、标题传落定的第几个字
        play(name, opts) {
            const spec = CONFIG.AUDIO[name];
            if (!spec || this.muted || !this.gestured) { return; }
            const ctx = this.ensure();
            // suspended 时 currentTime 不走，排进去的音会在解锁那一刻挤着放——没解锁就静默跳过
            if (!ctx || ctx.state !== 'running') { return; }
            const at = ctx.currentTime;
            this.voices = this.voices.filter(function (voice) { return voice.endsAt > at; });
            const root = AudioSys.rootOf(spec, opts);
            for (const layer of spec.voices || [spec]) {
                if (this.voices.length >= CONFIG.AUDIO.maxVoices) { this.dropOldest(); }
                this.voice(at, Object.assign({}, spec, layer), root);
            }
        }

        // 按 step 取音高，超出表长封顶："第 10 击起音高不再爬"是这条表规则，不在调用点写 if
        static rootOf(spec, opts) {
            if (!spec.scale) { return spec.freq; }
            const step = (opts && opts.step) || 0;
            return spec.scale[Math.max(0, Math.min(step, spec.scale.length - 1))];
        }

        // 一层的声音链：源（振荡器或噪声）→ 可选滤波 → 增益包络 → master。
        // attack 淡入防咔哒，指数淡出到听不见，glide 是滑音（坠毁的低频下滑、GO 的上扫）
        voice(start, spec, root) {
            const ctx = this.ctx;
            const at = start + (spec.at || 0);
            const endsAt = at + spec.dur + CONFIG.AUDIO.tail;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(spec.gain, at + CONFIG.AUDIO.attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + spec.dur);
            gain.connect(this.master);

            // chain 是这一层建出来的全部节点（收尾一起摘），timed 是其中要 start / stop 的源
            const chain = [gain];
            const timed = [];
            let input = gain;
            let source = null;

            if (spec.noise) {
                // 噪声那层要滤波器：低通从亮扫到闷才是"被吸进去"，白噪声直接放只是一声"沙"
                const filter = ctx.createBiquadFilter();
                filter.type = spec.noise.type || 'lowpass';
                filter.Q.value = spec.noise.q == null ? 1 : spec.noise.q;
                filter.frequency.setValueAtTime(spec.noise.from, at);
                filter.frequency.exponentialRampToValueAtTime(spec.noise.to, at + spec.dur);
                filter.connect(gain);
                chain.push(filter);
                input = filter;
                source = ctx.createBufferSource();
                source.buffer = this.noiseBuffer();
                source.loop = true;
                chain.push(source);
                // 每次从缓冲的随机位置起：一段噪声反复从头放会听出"是同一个采样"
                source.start(at, Math.random());
            } else {
                source = ctx.createOscillator();
                source.type = spec.type;
                // freq 是绝对音高，ratio 是相对根音的倍率（琶音用它），两个都不写就是根音本身
                const freq = spec.freq == null ? root * (spec.ratio || 1) : spec.freq;
                source.frequency.setValueAtTime(freq, at);
                if (spec.glide) { source.frequency.exponentialRampToValueAtTime(spec.glide, at + spec.dur); }
                chain.push(source);
                source.start(at);
            }
            source.connect(input);
            timed.push(source);

            // 颤音：LFO 连到包络那个 AudioParam 上是**相加**，包络形状不变、整体按 rate 起伏。
            // 深度按这一层自己的峰值算，depth 1 就是"颤到静音"
            if (spec.tremolo) {
                const lfo = ctx.createOscillator();
                const depth = ctx.createGain();
                lfo.frequency.value = spec.tremolo.rate;
                depth.gain.value = spec.gain * spec.tremolo.depth;
                lfo.connect(depth);
                depth.connect(gain.gain);
                lfo.start(at);
                chain.push(lfo, depth);
                timed.push(lfo);
            }

            timed.forEach(function (node) { node.stop(endsAt); });
            // 收尾挂在源上：这一层的所有节点同一个 endsAt 停，源停那一刻把整条链从 master 摘掉
            source.onended = function () {
                chain.forEach(function (node) { node.disconnect(); });
            };
            this.voices.push({ gain: gain, timed: timed, endsAt: endsAt });
        }

        // 白噪声缓冲建一次全程复用：每次现造一段是白扔几百 KB，也让 GC 在连打时多干活
        noiseBuffer() {
            if (this.noise) { return this.noise; }
            const ctx = this.ctx;
            const length = Math.max(1, Math.floor(ctx.sampleRate * CONFIG.AUDIO.noiseSeconds));
            const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < length; i++) { data[i] = Math.random() * 2 - 1; }
            this.noise = buffer;
            return buffer;
        }

        // 并发上限丢最老：8ms 淡出再停，直接 stop 会咔哒。抢的是队首——寿命短的先排前面，
        // 与特效池"抢最旧"同一条纪律，只是这里最旧 = 最早起音。一层一条记录，
        // 所以一个四层琶音被抢时是逐层被抢（听起来是琶音断尾，不是整件事没发生）
        dropOldest() {
            const voice = this.voices.shift();
            if (!voice) { return; }
            const now = this.ctx.currentTime;
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
            voice.gain.gain.linearRampToValueAtTime(0, now + CONFIG.AUDIO.fade);
            voice.timed.forEach(function (node) {
                try { node.stop(now + 0.01); } catch (err) { /* 已停过的音再 stop 只当没发生 */ }
            });
        }
    }

    let shared = null;

    // 与 storage 同一个套路：全项目一份，菜单设置面板与 GameScene 读写的是同一份音量/静音
    systems.audio = function () {
        if (!shared) { shared = new AudioSys(); }
        return shared;
    };

    systems.AudioSys = AudioSys;
})(window.ShootingStars = window.ShootingStars || {});
