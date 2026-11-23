(function (win) {
	'use strict';

	var FILES = 'ABCDEFGH';

	var KNIGHT_DIRS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
	var KING_DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
	var DIAG_DIRS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
	var ORTH_DIRS = [[1, 0], [0, -1], [-1, 0], [0, 1]];

	var PIECES = {
		n: { key: 'n', name: '马', glyph: '♞', dirs: KNIGHT_DIRS, ray: false },
		k: { key: 'k', name: '王', glyph: '♚', dirs: KING_DIRS, ray: false },
		b: { key: 'b', name: '象', glyph: '♝', dirs: DIAG_DIRS, ray: true },
		r: { key: 'r', name: '车', glyph: '♜', dirs: ORTH_DIRS, ray: true },
		q: { key: 'q', name: '后', glyph: '♛', dirs: DIAG_DIRS.concat(ORTH_DIRS), ray: true }
	};

	var PIECE_ORDER = ['n', 'k', 'b', 'r', 'q'];

	function inside(f, r) {
		return f >= 0 && f < 8 && r >= 0 && r < 8;
	}

	function name(f, r) {
		return FILES[f] + (r + 1);
	}

	function parse(sq) {
		if (typeof sq !== 'string' || sq.length !== 2) return null;
		var f = FILES.indexOf(sq[0].toUpperCase());
		var r = parseInt(sq[1], 10) - 1;
		if (f < 0 || !(r >= 0 && r < 8)) return null;
		return { f: f, r: r };
	}

	function allSquares() {
		var out = [];
		for (var r = 0; r < 8; r++) {
			for (var f = 0; f < 8; f++) out.push(name(f, r));
		}
		return out;
	}

	function moves(piece, sq) {
		var p = PIECES[piece];
		var from = parse(sq);
		if (!p || !from) return [];
		var out = [];
		for (var i = 0; i < p.dirs.length; i++) {
			var df = p.dirs[i][0], dr = p.dirs[i][1];
			var f = from.f + df, r = from.r + dr;
			while (inside(f, r)) {
				out.push(name(f, r));
				if (!p.ray) break;
				f += df;
				r += dr;
			}
		}
		return out;
	}

	function knightBFS(from) {
		var dist = {}, prev = {};
		dist[from] = 0;
		var queue = [from];
		for (var head = 0; head < queue.length; head++) {
			var cur = queue[head];
			var next = moves('n', cur);
			for (var i = 0; i < next.length; i++) {
				var sq = next[i];
				if (dist[sq] === undefined) {
					dist[sq] = dist[cur] + 1;
					prev[sq] = cur;
					queue.push(sq);
				}
			}
		}
		return { dist: dist, prev: prev };
	}

	function knightDistances(from) {
		return knightBFS(from).dist;
	}

	function knightPath(from, to) {
		if (from === to) return [from];
		var bfs = knightBFS(from);
		if (bfs.dist[to] === undefined) return null;
		var path = [to];
		while (path[0] !== from) path.unshift(bfs.prev[path[0]]);
		return path;
	}

	function randomSquare() {
		return name(Math.floor(Math.random() * 8), Math.floor(Math.random() * 8));
	}

	win.Chess = {
		FILES: FILES,
		PIECES: PIECES,
		PIECE_ORDER: PIECE_ORDER,
		inside: inside,
		name: name,
		parse: parse,
		allSquares: allSquares,
		moves: moves,
		knightDistances: knightDistances,
		knightPath: knightPath,
		randomSquare: randomSquare
	};
})(typeof window !== 'undefined' ? window : this);