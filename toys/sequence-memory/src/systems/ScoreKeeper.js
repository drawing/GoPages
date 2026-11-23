(function (ns) {
    'use strict';

    const systems = ns.systems = ns.systems || {};

    // 组合键 = 类型 × 模式 × 方向 × 速度档（harness/gameplay.md 计分与记录）。
    // 能产生记录的 (模式, 方向, 速度) 三元组已收敛到 PRESETS——Setup.normalize 保证草稿永远
    // 落在一个胶囊上，所以合法键集 = TYPES × PRESETS（4 × 3 = 12），不在集里的组合不产生记录。
    // 用 null 原型的表查键，手改出来的 __proto__ 取不到真值
    const COMBO_KEYS = (function () {
        const keys = Object.create(null);
        ns.TYPES.forEach(function (type) {
            ns.PRESETS.forEach(function (preset) {
                keys[[type.id, preset.mode, preset.direction, preset.speed].join('-')] = true;
            });
        });
        return keys;
    })();

    function intValue(value) {
        return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    }

    function timeValue(value) {
        return typeof value === 'number' && isFinite(value) && value > 0 ? value : 0;
    }

    // 读值校验：存进去的可能是旧版本 / 手改的 / 损坏的 JSON。未知键与非法值一律丢弃或归零，
    // 不让一个坏字段把记录页画炸（与 Prefs 同一条纪律）。runs 只留最近 HISTORY_LIMIT 局
    function sanitizeRun(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        return { score: intValue(raw.score), at: timeValue(raw.at) };
    }

    function sanitizeRecord(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        const runs = Array.isArray(raw.runs)
            ? raw.runs.map(sanitizeRun).filter(Boolean).slice(-ns.HISTORY_LIMIT)
            : [];
        return {
            best: intValue(raw.best),
            bestAt: timeValue(raw.bestAt),
            errors: intValue(raw.errors),
            ms: intValue(raw.ms),
            taps: intValue(raw.taps),
            runs: runs
        };
    }

    // 记录页的榜内排序（harness/gameplay.md 计分与记录）：最高长度 desc → 总错次 asc →
    // 平均复现用时 asc，三者全同回落玩法档原序。排的是**组合**不是局——即点即判下每局恰好
    // 错一次终局，一局的总错次恒为 1，第一顺位在局级是死键
    function compareBoard(a, b) {
        // 没玩过的档（best 为 null）排在有记录的后面，但它仍要在榜里看得见
        const bestA = a.best == null ? -1 : a.best;
        const bestB = b.best == null ? -1 : b.best;
        if (bestA !== bestB) { return bestB - bestA; }
        if (a.errors !== b.errors) { return a.errors - b.errors; }
        // 平均复现用时缺（taps 为 0）当无穷大排后：comparator 里出 NaN 会让排序结果未定义
        const avgA = a.avg == null ? Infinity : a.avg;
        const avgB = b.avg == null ? Infinity : b.avg;
        if (avgA !== avgB) { return avgA < avgB ? -1 : 1; }
        return a.order - b.order;
    }

    // 记录层：一份存档（'records'）装全部组合，键是组合键，值是 sanitizeRecord 的那六个字段。
    // best / bestAt 是历史最高与达成日期；errors / ms / taps 按组合累计，供 tie-break
    //（总错次少 → 平均复现用时短 = ms / taps，harness/gameplay.md）；runs 是最近 20 局曲线素材。
    // **5d 的常模百分位是派生值不进存档**：它由 best / score 现算（systems/Norms），
    // 存下来就会在常模数据改了之后与档案里的旧值各说各话
    class ScoreKeeper {
        constructor(storage) {
            this.storage = storage || systems.storage();
        }

        // 四个键各自回落到默认档（finder 语义），再查合法键集：PRESETS 没覆盖的组合返回 null，
        // 读写都绕开它——记录只跟同组合比，不合法的组合压根不该有记录
        static comboKey(picks) {
            const source = picks || {};
            const key = [
                ns.typeById(source.type).id,
                ns.modeById(source.mode).id,
                ns.directionById(source.direction).id,
                ns.speedById(source.speed).id
            ].join('-');
            return COMBO_KEYS[key] ? key : null;
        }

        // 每次都洗成新对象交出去，调用方改不到存档
        recordOf(picks) {
            const key = ScoreKeeper.comboKey(picks);
            if (!key) { return null; }
            const map = this.storage.read('records', null);
            if (!map || typeof map !== 'object') { return null; }
            return sanitizeRecord(map[key]);
        }

        // 最高分为 0 视同没有记录（返回 null，界面显示"–"）：score 0 的局仍进 runs 与累计，
        // 但"最高 0"不是玩家想读的成绩。首页与结算共用这一份口径，不会一边说没记录一边说破纪录
        bestOf(picks) {
            const record = this.recordOf(picks);
            return record && record.best > 0 ? record.best : null;
        }

        // 一个类型的记录页素材（5b，harness/ui.md 记录页）：玩法档各一条，冲榜档按 tie-break 排好，
        // 休闲单独一组不参与那个顺序（harness/gameplay.md"单独一栏不混排行"，保持玩法档原序）。
        // 读 + 分组 + 排序全在这里做完，场景只负责画——纯逻辑因此能在 Node 里测（AGENTS 分层红线）。
        // 交出去的是数字不是字符串：措辞、日期与"秒/项"的格式化归场景。
        // 5d 起常模百分位也在这里算好（每档一个数或 null），记录页仍然只有这一个读口径
        typeBoard(typeId) {
            const type = ns.typeById(typeId);
            const source = this.storage.read('records', null);
            // 整份 map 只读一次：三个组合各读一次盘没有意义（recordOf 是每次重读的那条路）
            const map = source && typeof source === 'object' ? source : null;

            const ranked = [];
            const leisure = [];
            ns.PRESETS.forEach(function (preset, order) {
                const picks = {
                    type: type.id,
                    mode: preset.mode,
                    direction: preset.direction,
                    speed: preset.speed
                };
                const record = map ? sanitizeRecord(map[ScoreKeeper.comboKey(picks)]) : null;
                const best = record && record.best > 0 ? record.best : null;
                const isRanked = ns.modeById(preset.mode).ranked;
                const entry = {
                    picks: picks,
                    preset: preset,
                    // 最高为 0 视同没有记录（与 bestOf 同一份口径，界面显示"–"）
                    best: best,
                    bestAt: record ? record.bestAt : 0,
                    errors: record ? record.errors : 0,
                    avg: record && record.taps > 0 ? record.ms / record.taps : null,
                    // 曲线素材（5c）：最近 HISTORY_LIMIT 局，按下棋先后排（横轴是局序不是分数）。
                    // 记录页只从 typeBoard 读，曲线不为它另走一次盘（"唯一的读口径"这条不变）；
                    // 没玩过的档给空数组，场景据此走空态
                    runs: record ? record.runs : [],
                    // 常模百分位（5d）：**只给冲榜档**——休闲是累积追加、重播允许复述，分数不是
                    // 广度测量，拿去查常模会把练习效应说成能力（与"休闲单独一栏不混排行"同一条纪律）。
                    // 无常模的类型（颜色 / 扑克）是 null，卡上那一句整句不画：卡上的数字是"最高"，
                    // 而最高在自己的历史里恒为第 1 好，"历史第几好"在记录页没有信息量
                    //（它只在结算说得出口，那里说的是这一局）
                    percentile: isRanked ? systems.Norms.percentile(type.id, preset.direction, best) : null,
                    order: order
                };
                (isRanked ? ranked : leisure).push(entry);
            });

            ranked.sort(compareBoard);
            return { ranked: ranked, leisure: leisure };
        }

        // 一局结束调一次（GameScene.proceed 在 session.finish() 之后）：结算屏的 create 会随
        // 转屏 restart 重放，提交放那里会把同一局重复记账。放弃的局（暂停 → 回首页）不经过这里
        submit(last) {
            const key = ScoreKeeper.comboKey(last && last.settings);
            if (!key) { return null; }

            // 写回前把整份存档洗一遍：未知键与坏记录趁这次落盘清掉，不留在存档里越攒越多
            const source = this.storage.read('records', null);
            const map = Object.create(null);
            if (source && typeof source === 'object') {
                Object.keys(source).forEach(function (k) {
                    if (!COMBO_KEYS[k]) { return; }
                    const record = sanitizeRecord(source[k]);
                    if (record) { map[k] = record; }
                });
            }

            const record = map[key] || { best: 0, bestAt: 0, errors: 0, ms: 0, taps: 0, runs: [] };
            const score = intValue(last.score);
            const previous = record.best;
            const now = Date.now();
            if (score > previous) {
                record.best = score;
                record.bestAt = now;
            }
            // 即点即判下每局恰好错一次终局，总错次按组合累计（harness/gameplay.md）
            record.errors += last.wrongAt != null ? 1 : 0;
            record.ms += intValue(last.ms);
            record.taps += intValue(last.taps);
            record.runs.push({ score: score, at: now });
            if (record.runs.length > ns.HISTORY_LIMIT) {
                record.runs = record.runs.slice(-ns.HISTORY_LIMIT);
            }
            map[key] = record;
            this.storage.write('records', map);

            // 结算的参照行（5d）也在这次提交里算完冻进快照：结算屏的 create 随转屏 restart 重放，
            // 现读活值会读到别的局（与 best / isRecord 同一条理由，harness/architecture.md 已知坑）。
            // 百分位只给冲榜档（见 typeBoard 那条），落不上的改用"历史第几好"——runs 此刻已含本局，
            // 名次里本来就该有它。rank 为 null 时 rankTotal 也跟着没意义（场景两种都不画）
            const picks = (last && last.settings) || {};
            const scores = record.runs.map(function (run) { return run.score; });
            return {
                best: record.best,
                previous: previous,
                isRecord: score > previous,
                percentile: ns.modeById(picks.mode).ranked
                    ? systems.Norms.percentile(ns.typeById(picks.type).id, ns.directionById(picks.direction).id, score)
                    : null,
                rank: systems.Norms.rankIn(score, scores),
                rankTotal: scores.length
            };
        }
    }

    let shared = null;

    // 全应用共用一份（与 systems.storage 同一条理由）：内存兜底时各场景读到的必须是同一份
    systems.scoreKeeper = function () {
        if (!shared) { shared = new ScoreKeeper(); }
        return shared;
    };

    systems.ScoreKeeper = ScoreKeeper;
})(window.SequenceMemory = window.SequenceMemory || {});