import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 与 index.html 的 loader 同源同序，但只取到 systems 为止：
// objects/scenes/main 要真 Phaser 与 canvas，跑在 node 里没有意义
const FILES = [
    'src/config.js',
    'src/utils/display.js',
    'src/utils/tween.js',
    'src/utils/ui.js',
    'src/utils/letters.js',
    'src/utils/sequence.js',
    'src/utils/touch.js',
    'src/utils/debug.js',
    'src/systems/SpawnDirector.js',
    'src/systems/ScoreKeeper.js',
    'src/systems/Storage.js',
    'src/systems/Settings.js',
    'src/systems/AudioSys.js'
];

// 只补到"加载期不抛异常"为止：tween.js 在 IIFE 顶层就要解析 scrim 颜色
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

// 在带假 window 的 context 里按序执行各 IIFE，返回 window.ShootingStars。
// windowExtras 注入假 window 属性（如 matchMedia / AudioContext），缺省什么都不补——
// 被测代码对缺失的浏览器 API 必须自己降级，这本身就是契约的一部分
export function load(windowExtras) {
    const context = vm.createContext(Object.assign({
        Phaser: makePhaserStub(),
        devicePixelRatio: 1,
        innerWidth: 800,
        innerHeight: 600
    }, windowExtras));

    vm.runInContext('globalThis.window = globalThis;', context, { filename: '<bootstrap>' });

    for (const file of FILES) {
        const path = join(ROOT, file);
        vm.runInContext(readFileSync(path, 'utf8'), context, { filename: path });
    }

    return vm.runInContext('window.ShootingStars', context);
}
