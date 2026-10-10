(function () {
    var input = document.getElementById('search-input');
    var resultsEl = document.getElementById('search-results');
    var statusEl = document.getElementById('search-status');
    var current = document.currentScript;
    var indexUrl = current && current.dataset.index;
    var index = null;
    var timer = null;

    if (!input || !resultsEl || !indexUrl) return;

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function load() {
        if (index) return Promise.resolve(index);
        return fetch(indexUrl)
            .then(function (r) { return r.json(); })
            .then(function (data) { index = data; return data; });
    }

    function highlight(el, text, terms) {
        if (!terms.length) {
            el.textContent = text;
            return;
        }
        var re = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'gi');
        var parts = text.split(re);
        parts.forEach(function (part) {
            if (!part) return;
            var isMatch = terms.some(function (t) { return part.toLowerCase() === t.toLowerCase(); });
            if (isMatch) {
                var m = document.createElement('mark');
                m.textContent = part;
                el.appendChild(m);
            } else {
                el.appendChild(document.createTextNode(part));
            }
        });
    }

    function snippet(text, term) {
        var i = text.toLowerCase().indexOf(term.toLowerCase());
        if (i < 0) return text.slice(0, 120);
        var start = Math.max(0, i - 40);
        var end = Math.min(text.length, i + term.length + 80);
        return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    }

    function render(hits, terms) {
        resultsEl.textContent = '';
        hits.forEach(function (h) {
            var li = document.createElement('li');
            var article = document.createElement('article');

            var h2 = document.createElement('h2');
            h2.className = 'post-title';
            var a = document.createElement('a');
            a.href = h.p.url;
            highlight(a, h.p.title, terms);
            h2.appendChild(a);
            article.appendChild(h2);

            var text = h.p.content || '';
            var firstHit = terms.reduce(function (acc, t) {
                return acc || (text.toLowerCase().indexOf(t) >= 0 ? t : '');
            }, '');
            var p = document.createElement('p');
            p.className = 'post-summary';
            p.style.whiteSpace = 'normal';
            highlight(p, snippet(text, firstHit || terms[0]), terms);
            article.appendChild(p);

            li.appendChild(article);
            resultsEl.appendChild(li);
        });
    }

    function search() {
        var terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        resultsEl.textContent = '';
        if (!terms.length) {
            statusEl.textContent = '';
            return;
        }
        statusEl.textContent = '搜索中…';
        load().then(function (data) {
            var hits = [];
            data.forEach(function (p) {
                var title = p.title.toLowerCase();
                var content = (p.content || '').toLowerCase();
                var match = terms.every(function (t) {
                    return title.indexOf(t) >= 0 || content.indexOf(t) >= 0;
                });
                if (!match) return;
                var inTitle = terms.some(function (t) { return title.indexOf(t) >= 0; });
                hits.push({ p: p, inTitle: inTitle });
            });
            hits.sort(function (a, b) { return (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0); });
            var total = hits.length;
            hits = hits.slice(0, 30);
            statusEl.textContent = total ? '共 ' + total + ' 条结果' + (total > hits.length ? '（显示前 ' + hits.length + ' 条）' : '') : '没有找到相关内容';
            render(hits, terms);
        }).catch(function () {
            statusEl.textContent = '搜索索引加载失败，请刷新重试';
        });
    }

    input.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(search, 150);
    });

    var q = new URLSearchParams(location.search).get('q');
    if (q) {
        input.value = q;
        search();
    }
})();
