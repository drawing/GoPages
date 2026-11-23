import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 与 index.html 的 loader 同源同序，但只取 config / systems：
// utils/ objects/ scenes/ 与 main.js 要真 Phaser 与 canvas，跑在 node 里没有意义。
// 后续纯逻辑模块两处一起加
const FILES = [
    'src/config.js',
    'src/systems/SequenceGenerator.js',
    'src/systems/Judge.js',
    // Storage / ScoreKeeper 是浏览器边界服务与记录层（5a）：外部依赖走构造参数注入，
    // 假 window 没有 localStorage 时探测退回内存。schema 与读值校验可测（AGENTS 测试边界）
    'src/systems/Storage.js',
    // Norms 是纯查表 + 正态换算（5d）：常模百分位与"历史第几好"两种参照都在这一处，
    // ScoreKeeper 提交时调它把参照数字冻进结算快照
    'src/systems/Norms.js',
    'src/systems/ScoreKeeper.js',
    // Prefs 读写走 systems.Storage（5a 统一探测口径），加载期退回内存默认值，不抛异常
    'src/systems/Prefs.js',
    'src/systems/Setup.js',
    'src/systems/session.js',
    // Audio 是浏览器边界服务（与 Storage 同类），浏览器 API 全在函数里惰性取：
    // 这里只验"加载期不抛异常"，行为不测（AGENTS 测试边界）
    'src/systems/Audio.js'
];

// AGENTS 要求与 shooting-stars 一致留一个最小 Phaser stub：只补到"加载期不抛异常"为止，
// 不实现任何 Phaser 行为。当前 FILES 只到 systems/，它们不碰引擎，所以这个 stub 只是兜底
function makePhaserStub() {
    return {
        Display: {
            Color: {
                HexStringToColor: function (hex) {
                    const int = parseInt(hex.slice(1), 16);
                    return {
                        color: int,
                        red: (int >> 16) & 255,
                        green: (int >> 8) & 255,
                        blue: int & 255
                    };
                }
            }
        },
        Cameras: { Scene2D: { Events: { FADE_OUT_COMPLETE: 'camerafadeoutcomplete' } } },
        Geom: { Rectangle: class Rectangle {} },
        Math: { Wrap: function (value) { return value; } }
    };
}

// 在带假 window 的 context 里按序执行各 IIFE，返回 window.SequenceMemory。
// 代价：返回的数组跨 realm，原型不是本地 Array，深比较前要先 Array.from 转一道
export function load() {
    const context = vm.createContext({
        Phaser: makePhaserStub(),
        devicePixelRatio: 1,
        innerWidth: 390,
        innerHeight: 844
    });

    vm.runInContext('globalThis.window = globalThis;', context, { filename: '<bootstrap>' });

    for (const file of FILES) {
        const path = join(ROOT, file);
        vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
    }

    return vm.runInContext('window.SequenceMemory', context);
}
