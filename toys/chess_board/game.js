(function (win, doc) {
	'use strict';

	var C = win.Chess;
	var PIECE_KEY = 'chess_board.piece';

	var el = {
		title: doc.getElementById('title'),
		timer: doc.getElementById('timer'),
		backMenu: doc.getElementById('back-menu'),
		backPlay: doc.getElementById('back-play'),
		main: doc.getElementById('main'),
		menu: doc.getElementById('menu'),
		play: doc.getElementById('play'),
		piecebar: doc.getElementById('piecebar'),
		prompt: doc.getElementById('prompt'),
		stats: doc.getElementById('stats'),
		entries: doc.getElementById('entries'),
		feedback: doc.getElementById('feedback'),
		actions: doc.getElementById('actions'),
		board: doc.getElementById('board'),
		keypad: doc.getElementById('keypad'),
		buffer: doc.getElementById('buffer'),
		keys: doc.getElementById('keys')
	};

	var state = {
		screen: 'menu',
		mode: 'reach',
		piece: loadPiece(),
		round: null,
		feedback: { text: '', kind: '' },
		key: { stage: 'file', file: null }
	};

	function loadPiece() {
		try {
			var p = win.localStorage.getItem(PIECE_KEY);
			if (C.PIECE_ORDER.indexOf(p) >= 0) return p;
		} catch (e) {}
		return 'n';
	}

	function savePiece() {
		try { win.localStorage.setItem(PIECE_KEY, state.piece); } catch (e) {}
	}

	function pick(list) {
		return list[Math.floor(Math.random() * list.length)];
	}

	function fmt(ms) {
		var s = Math.max(0, Math.floor(ms / 1000));
		var m = Math.floor(s / 60);
		return m + ':' + ('0' + (s % 60)).slice(-2);
	}

	function elapsed(r) {
		return r.over ? r.elapsed : Date.now() - r.start;
	}

	function say(text, kind) {
		state.feedback = { text: text, kind: kind || '' };
	}

	// ---- 出题 ----

	function newRound() {
		var r;
		if (state.mode === 'reach') {
			var origin = C.randomSquare();
			r = {
				kind: 'reach',
				piece: state.piece,
				origin: origin,
				targets: C.moves(state.piece, origin),
				found: [],
				wrong: [],
				over: false,
				revealed: false,
				start: Date.now(),
				elapsed: 0
			};
			say('先点字母，再点数字。');
		} else {
			var from = C.randomSquare();
			var dist = C.knightDistances(from);
			var pool = Object.keys(dist).filter(function (sq) {
				return dist[sq] >= 3 && dist[sq] <= 5;
			});
			var to = pick(pool);
			r = {
				kind: 'route',
				from: from,
				to: to,
				path: [from],
				answer: C.knightPath(from, to),
				min: dist[to],
				over: false,
				revealed: false,
				start: Date.now(),
				elapsed: 0
			};
			say('报第一个落脚点。');
		}
		state.round = r;
		state.key = { stage: 'file', file: null };
		el.main.scrollTop = 0;
	}

	function finish(text, kind) {
		var r = state.round;
		r.elapsed = Date.now() - r.start;
		r.over = true;
		r.revealed = true;
		say(text, kind);
	}

	// ---- 判定 ----

	function submit(sq) {
		var r = state.round;
		if (!r || r.over) return;
		if (r.kind === 'reach') submitReach(r, sq);
		else submitRoute(r, sq);
	}

	function submitReach(r, sq) {
		var pieceName = C.PIECES[r.piece].name;
		if (r.found.indexOf(sq) >= 0) {
			say(sq + ' 已经报过了。', 'bad');
			return;
		}
		if (r.targets.indexOf(sq) < 0) {
			if (r.wrong.indexOf(sq) < 0) r.wrong.push(sq);
			say('这不是' + pieceName + '一步能走到的格子。', 'bad');
			return;
		}
		r.found.push(sq);
		var left = r.targets.length - r.found.length;
		if (left === 0) {
			finish('全部报齐了，' + r.targets.length + ' 个。用时 ' + fmt(r.elapsed) + '。', 'ok');
		} else {
			say('对，还差 ' + left + ' 个。', 'ok');
		}
	}

	function submitRoute(r, sq) {
		var cur = r.path[r.path.length - 1];
		if (C.moves('n', cur).indexOf(sq) < 0) {
			say('这不是马的步数。', 'bad');
			return;
		}
		r.path.push(sq);
		if (sq === r.to) {
			var steps = r.path.length - 1;
			finish('走到了：你走了 ' + steps + ' 步，最短 ' + r.min + ' 步。', 'ok');
		} else {
			say('落在 ' + sq + '，继续。', 'ok');
		}
	}

	function reveal() {
		var r = state.round;
		if (r.kind === 'reach') {
			finish('答案揭晓：共 ' + r.targets.length + ' 个，你报中 ' + r.found.length + ' 个。');
		} else {
			finish('答案揭晓：最短 ' + r.min + ' 步。');
		}
	}

	function undo() {
		var r = state.round;
		if (r.kind !== 'route' || r.path.length < 2) return;
		r.path.pop();
		say('退回 ' + r.path[r.path.length - 1] + '。');
	}

	// ---- 键盘 ----

	function onKey(k) {
		if (!state.round || state.round.over) return;
		if (state.key.stage === 'file') {
			if (C.FILES.indexOf(k) < 0) return;
			state.key = { stage: 'rank', file: k };
		} else {
			if (C.FILES.indexOf(k) >= 0) {
				state.key = { stage: 'rank', file: k };
				render();
				return;
			}
			if ('12345678'.indexOf(k) < 0) return;
			var sq = state.key.file + k;
			state.key = { stage: 'file', file: null };
			submit(sq);
		}
		render();
	}

	function cancelKey() {
		if (state.key.stage !== 'rank') return;
		state.key = { stage: 'file', file: null };
		render();
	}

	// ---- 渲染 ----

	function render() {
		var playing = state.screen === 'play';
		el.menu.hidden = playing;
		el.play.hidden = !playing;
		el.keypad.hidden = !playing;
		el.backMenu.hidden = playing;
		el.backPlay.hidden = !playing;
		el.title.textContent = playing ? (state.mode === 'reach' ? '一步可达' : '马的路线') : '盲棋训练';
		if (!playing) {
			el.timer.textContent = '';
			return;
		}
		renderPlay();
		renderKeypad();
		tick();
	}

	function renderPlay() {
		var r = state.round;
		renderPiecebar(r);
		renderPrompt(r);
		renderStats(r);
		renderEntries(r);
		el.feedback.textContent = state.feedback.text;
		el.feedback.className = 'feedback' + (state.feedback.kind ? ' ' + state.feedback.kind : '');
		renderActions(r);
		if (r.revealed) {
			el.board.hidden = false;
			el.board.innerHTML = boardHTML(r);
		} else {
			el.board.hidden = true;
			el.board.innerHTML = '';
		}
	}

	function renderPiecebar(r) {
		if (r.kind !== 'reach') {
			el.piecebar.hidden = true;
			el.piecebar.innerHTML = '';
			return;
		}
		el.piecebar.hidden = false;
		el.piecebar.innerHTML = C.PIECE_ORDER.map(function (key) {
			var p = C.PIECES[key];
			return '<button class="piece" type="button" data-piece="' + key + '" aria-pressed="' +
				(key === r.piece) + '"><span aria-hidden="true">' + p.glyph + '</span>' + p.name + '</button>';
		}).join('');
	}

	function renderPrompt(r) {
		var html;
		if (r.kind === 'reach') {
			var p = C.PIECES[r.piece];
			html = '<div class="prompt-main"><span class="prompt-glyph" aria-hidden="true">' + p.glyph +
				'</span>' + p.name + ' 在 <b>' + r.origin + '</b></div>' +
				'<p class="prompt-sub">空棋盘，无阻挡。它一步能走到 <b>' + r.targets.length + '</b> 个格子，全部报出来。</p>';
		} else {
			html = '<div class="prompt-main"><span class="prompt-glyph" aria-hidden="true">' + C.PIECES.n.glyph +
				'</span>马 <b>' + r.from + '</b><span class="prompt-arrow">→</span><b>' + r.to + '</b></div>' +
				'<p class="prompt-sub">一格格报中间的落脚点，把马跳到终点。走错只提示一句，可以悔一步。</p>';
		}
		el.prompt.innerHTML = html;
	}

	function renderStats(r) {
		var html;
		if (r.kind === 'reach') {
			html = '<span>已报 <b>' + r.found.length + '</b> / ' + r.targets.length + '</span>' +
				'<span>误报 <b>' + r.wrong.length + '</b></span>';
		} else {
			html = '<span>已走 <b>' + (r.path.length - 1) + '</b> 步</span>';
			if (r.over) html += '<span>最短 <b>' + r.min + '</b> 步</span>';
		}
		el.stats.innerHTML = html;
	}

	function renderEntries(r) {
		var html;
		if (r.kind === 'reach') {
			html = r.found.length
				? r.found.map(function (sq) { return '<span class="chip hit">' + sq + '</span>'; }).join('')
				: '<span class="empty">还没报过格子。</span>';
		} else {
			var parts = r.path.map(function (sq, i) {
				var cls = i === r.path.length - 1 ? 'chip cur' : 'chip';
				return '<span class="' + cls + '">' + sq + '</span>';
			});
			if (r.path[r.path.length - 1] !== r.to) parts.push('<span class="chip goal">' + r.to + '</span>');
			html = parts.join('<span class="sep" aria-hidden="true">›</span>');
		}
		el.entries.innerHTML = html;
	}

	function renderActions(r) {
		var html = '';
		if (r.over) {
			html = '<button class="act primary" type="button" data-act="next">下一题</button>';
		} else {
			if (r.kind === 'route') {
				html += '<button class="act" type="button" data-act="undo"' +
					(r.path.length < 2 ? ' disabled' : '') + '>悔一步</button>';
			}
			html += '<button class="act" type="button" data-act="answer">看答案</button>' +
				'<button class="act" type="button" data-act="next">换一题</button>';
		}
		el.actions.innerHTML = html;
	}

	function renderKeypad() {
		var over = state.round.over;
		var picking = !over && state.key.stage === 'rank';
		var labels = picking ? '12345678' : C.FILES;

		el.buffer.className = 'buffer' + (picking ? ' picking' : '');
		el.buffer.disabled = !picking;
		if (over) {
			el.buffer.innerHTML = '<span>本局结束</span><span class="hint">点"下一题"继续</span>';
		} else if (picking) {
			el.buffer.innerHTML = '<b>' + state.key.file + '?</b><span class="hint">点这里改字母</span>';
		} else {
			el.buffer.innerHTML = '<span>报一个坐标</span><span class="hint">先字母 A–H，再数字 1–8</span>';
		}

		var html = '';
		for (var i = 0; i < 8; i++) {
			html += '<button class="key" type="button" data-key="' + labels[i] + '"' +
				(over ? ' disabled' : '') + '>' + labels[i] + '</button>';
		}
		el.keys.innerHTML = html;
	}

	function boardHTML(r) {
		var cls = {}, body = {};
		function add(sq, c) { cls[sq] = (cls[sq] || '') + ' ' + c; }

		if (r.kind === 'reach') {
			r.targets.forEach(function (sq) {
				var hit = r.found.indexOf(sq) >= 0;
				add(sq, hit ? 'hit' : 'miss');
				body[sq] = '<span class="dot"></span>';
			});
			r.wrong.forEach(function (sq) {
				add(sq, 'wrong');
				body[sq] = '<span class="cross" aria-hidden="true">×</span>';
			});
			add(r.origin, 'origin');
			body[r.origin] = '<span class="glyph" aria-hidden="true">' + C.PIECES[r.piece].glyph + '</span>';
		} else {
			r.answer.forEach(function (sq) { add(sq, 'answer'); });
			r.path.forEach(function (sq, i) {
				add(sq, 'route');
				body[sq] = i === 0
					? '<span class="glyph" aria-hidden="true">' + C.PIECES.n.glyph + '</span>'
					: '<span class="num">' + i + '</span>';
			});
			if (!body[r.to]) {
				add(r.to, 'goal');
				body[r.to] = '<span class="glyph" aria-hidden="true">◎</span>';
			}
		}

		var html = '<div class="board">';
		for (var rank = 8; rank >= 1; rank--) {
			html += '<div class="axis">' + rank + '</div>';
			for (var f = 0; f < 8; f++) {
				var sq = C.FILES[f] + rank;
				var shade = (f + rank) % 2 === 0 ? 'light' : 'dark';
				html += '<div class="sq ' + shade + (cls[sq] || '') + '"><i>' + sq + '</i>' + (body[sq] || '') + '</div>';
			}
		}
		html += '<div class="axis"></div>';
		for (var g = 0; g < 8; g++) html += '<div class="axis">' + C.FILES[g] + '</div>';
		html += '</div>';

		html += r.kind === 'reach'
			? '<p class="legend">实心 = 你报对的 · 空心 = 漏掉的 · × = 误报 · 方框里是它本来所在的格子。</p>'
			: '<p class="legend">数字 = 你走的顺序 · 虚线 = 一条最短路（' + r.min + ' 步）。</p>';
		return html;
	}

	function tick() {
		if (state.screen !== 'play' || !state.round) return;
		el.timer.textContent = fmt(elapsed(state.round));
	}

	// ---- 事件 ----

	function startMode(mode) {
		state.mode = mode;
		state.screen = 'play';
		newRound();
		render();
	}

	function backToMenu() {
		state.screen = 'menu';
		state.round = null;
		render();
	}

	el.menu.addEventListener('click', function (e) {
		var btn = e.target.closest('[data-mode]');
		if (btn) startMode(btn.dataset.mode);
	});

	el.backPlay.addEventListener('click', backToMenu);

	el.piecebar.addEventListener('click', function (e) {
		var btn = e.target.closest('[data-piece]');
		if (!btn || btn.dataset.piece === state.piece) return;
		state.piece = btn.dataset.piece;
		savePiece();
		newRound();
		render();
	});

	el.actions.addEventListener('click', function (e) {
		var btn = e.target.closest('[data-act]');
		if (!btn) return;
		var act = btn.dataset.act;
		if (act === 'next') newRound();
		else if (act === 'answer') reveal();
		else if (act === 'undo') undo();
		render();
	});

	el.keys.addEventListener('click', function (e) {
		var btn = e.target.closest('[data-key]');
		if (btn && !btn.disabled) onKey(btn.dataset.key);
	});

	el.buffer.addEventListener('click', cancelKey);

	doc.addEventListener('keydown', function (e) {
		if (state.screen !== 'play' || e.metaKey || e.ctrlKey || e.altKey) return;
		var k = e.key;
		if (k === 'Backspace' || k === 'Escape') {
			e.preventDefault();
			cancelKey();
			return;
		}
		if (k === 'Enter' && state.round && state.round.over) {
			e.preventDefault();
			newRound();
			render();
			return;
		}
		if (typeof k !== 'string' || k.length !== 1) return;
		k = k.toUpperCase();
		if (C.FILES.indexOf(k) >= 0 || '12345678'.indexOf(k) >= 0) {
			e.preventDefault();
			onKey(k);
		}
	});

	win.setInterval(tick, 1000);
	render();
})(window, document);