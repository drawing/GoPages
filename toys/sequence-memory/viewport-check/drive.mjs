// 仅当用户明确要求时才运行（AGENTS.md"验证边界"一节的用户指令例外），AI 不得自主启动。
// 浏览器侧脚本：collect.mjs（全量采集）与 shoot.mjs（复现截图）共用一份，两边不会走偏。
// 这里只产出 JS 字符串，不执行；执行在各自的 agent-browser 封装里。

// 第一步：清局、按需开局、切到目标场景。scene.start 走"当前活跃场景"那条路，与游戏自己的 fadeTo 同机制
export function driveJs(c) {
  const p = {
    screen: c.screen, type: c.type || null, mode: c.mode || null,
    dir: c.dir || null, length: c.length || 0, phase: c.phase || null,
    target: { menu: 'MenuScene', settings: 'SettingsScene', game: 'GameScene', pause: 'GameScene', over: 'GameOverScene' }[c.screen],
  };
  return `(function(){
  var ns = window.SequenceMemory, S = ns.systems, gm = ns.game, P = ${JSON.stringify(p)};
  function activeScenes(){ return gm.scene.scenes.filter(function(s){ return s.sys.isActive() || s.sys.isPaused(); }); }
  function go(key){
    var a = activeScenes();
    var sc = a.length ? a[0] : null;
    if (sc) { sc.scene.start(key); return 'from:' + sc.scene.key; }
    gm.scene.start(key); return 'from:manager';
  }
  S.session.end();
  // 游戏自己的不变量是"同一时刻只有一个主场景（+ 可选 Pause 覆盖层）"，每次转场都停掉前一屏。
  // scene.start 只停调用者，驱动若从残留的活跃场景切屏会把旧场景留在台上串台
  // （SettingsScene 曾从第二个视口起一直挂到最后一个用例），所以先把别的都停干净
  gm.scene.scenes.forEach(function(s){
    if (s.scene.key === P.target) return;
    if (s.sys.isActive() || s.sys.isPaused()) {
      if (s.sys.isPaused()) { s.scene.resume(); }
      s.scene.stop();
    }
  });
  var needSession = (P.screen === 'game' || P.screen === 'pause' || P.screen === 'over');
  if (needSession) {
    var picks = {};
    if (P.type) picks.type = P.type;
    if (P.mode) picks.mode = P.mode;
    if (P.dir) picks.direction = P.dir;
    S.session.start(S.Setup.snapshot(picks));
  }
  if (P.screen === 'over') {
    var guard = 0;
    while (S.session.round().length < P.length && guard++ < 60) { S.session.advance(); }
    // 真实玩法是"出错即终"，结算永远由一次错点产生，wrongAt 必非空。
    // 全点对的假局会让 GameOverScene.buildDiagnosis 读 rows[null].expected 抛异常、场景卡死在 CREATING，
    // 所以在中间位置故意点错——顺带让 ok / bad / missed 三态都出现
    var j = S.session.judge();
    var exp = S.session.round().sequence.slice();
    if (P.dir === 'backward') exp.reverse();
    var at = Math.floor(exp.length / 2), alt = null;
    for (var q = 0; q < exp.length; q++) { if (exp[q] !== exp[at]) { alt = exp[q]; break; } }
    for (var i = 0; i < at && alt !== null; i++) { j.tap(exp[i]); }
    if (alt !== null) { j.tap(alt); } else { for (var z = 0; z < exp.length; z++) { j.tap(exp[z]); } }
    var snap = S.session.finish();
    P.overWrongAt = snap ? snap.wrongAt : 'nosnap';
  }
  return { nav: go(P.target), overWrongAt: P.overWrongAt === undefined ? null : P.overWrongAt };
})()`;
}

// 第二步：相位 / 覆盖层。GameScene 已经 create 过了，这里改 session 再 restart 重排
export function phaseJs(c) {
  if (c.screen === 'game' && c.phase === 'recall') {
    return `(function(){
  var ns = window.SequenceMemory, S = ns.systems, gm = ns.game;
  S.session.cover(); S.session.beginRecall();
  var sc = gm.scene.getScene('GameScene');
  sc.scene.restart();
  return 'recall';
})()`;
  }
  if (c.screen === 'pause') {
    return `(function(){
  var ns = window.SequenceMemory, S = ns.systems, gm = ns.game;
  S.session.pause();
  var sc = gm.scene.getScene('GameScene');
  sc.scene.launch('PauseScene');
  sc.scene.pause();
  return 'paused';
})()`;
  }
  return `(function(){ return 'noop'; })()`;
}

// 第三步：量测。场景树递归序列化，带 bounds / hitArea / 文本（文本是唯一可用的语义锚点——对象全都没有 name）
export const MEASURE_JS = `(function(){
  var ns = window.SequenceMemory, gm = ns.game, S = ns.systems;
  function ser(o, depth){
    var n = { t: o.type, v: o.visible !== false, a: (typeof o.alpha === 'number' ? Math.round(o.alpha * 100) / 100 : 1) };
    if (typeof o.text === 'string' && o.text) n.s = o.text.slice(0, 60);
    try {
      if (o.getBounds) {
        var r = o.getBounds();
        n.b = [r.x, r.y, r.width, r.height].map(function(v){ return Math.round(v * 10) / 10; });
      }
    } catch (e) { n.b = null; }
    if (o.input && o.input.hitArea) {
      var m = o.getWorldTransformMatrix();
      var hw = o.input.hitArea.width * Math.abs(m.scaleX), hh = o.input.hitArea.height * Math.abs(m.scaleY);
      n.hit = [
        Math.round(hw * 10) / 10,
        Math.round(hh * 10) / 10,
        o.input.enabled !== false
      ];
      // hitArea 在纹理空间以左上为原点、Phaser 判定时补 displayOrigin，等效于以物体中心居中的矩形；
      // 容器包围盒会被装饰光晕撑大（334 的盒包 159 的判定区），量"点不点得到 / 压不压到"必须用这个
      n.hr = [
        Math.round((m.tx - hw / 2) * 10) / 10,
        Math.round((m.ty - hh / 2) * 10) / 10,
        Math.round(hw * 10) / 10,
        Math.round(hh * 10) / 10
      ];
    }
    if (o.list && depth < 10) n.k = o.list.map(function(c){ return ser(c, depth + 1); });
    return n;
  }
  var scenes = gm.scene.scenes.filter(function(s){ return s.sys.isActive() || s.sys.isPaused(); });
  return {
    dpr: window.devicePixelRatio, rs: ns.RENDER_SCALE,
    canvas: [gm.canvas.width, gm.canvas.height, gm.canvas.clientWidth, gm.canvas.clientHeight],
    inner: [window.innerWidth, window.innerHeight],
    phase: S.session.phase(),
    len: S.session.round() ? S.session.round().length : null,
    scenes: scenes.map(function(sc){
      return {
        key: sc.scene.key, paused: sc.sys.isPaused(), view: ns.utils.layout(sc),
        tree: sc.children.list.map(function(o){ return ser(o, 0); })
      };
    })
  };
})()`;

// 体检：场景卡死（create 抛异常会把它留在 CREATING、其余 SHUTDOWN）之后驱动就再也起不来，
// 因为它靠"找一个活跃场景"来切屏。死了就整页 reload 重来
export const HEALTH_JS = `(function(){
  var ns = window.SequenceMemory;
  if (!ns || !ns.game) return 'nogame';
  var a = ns.game.scene.scenes.filter(function(s){ return s.sys.isActive() || s.sys.isPaused(); });
  return a.length ? 'ok' : 'dead';
})()`;
