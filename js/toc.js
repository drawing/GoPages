(function () {
    var tocNav = document.querySelector('.toc nav');
    if (!tocNav) return;

    var items = [];
    tocNav.querySelectorAll('a[href^="#"]').forEach(function (a) {
        var id;
        try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch (e) { return; }
        var heading = document.getElementById(id);
        if (heading) items.push({ link: a, heading: heading });
    });
    if (!items.length) return;

    var OFFSET = 96;
    var current = null;

    // 只滚动目录容器自身，绝不影响页面滚动
    function keepVisible(link) {
        var navRect = tocNav.getBoundingClientRect();
        var linkRect = link.getBoundingClientRect();
        var pad = 24;
        if (linkRect.top < navRect.top + pad) {
            tocNav.scrollTop -= (navRect.top + pad) - linkRect.top;
        } else if (linkRect.bottom > navRect.bottom - pad) {
            tocNav.scrollTop += linkRect.bottom - (navRect.bottom - pad);
        }
    }

    function refresh() {
        var doc = document.documentElement;
        var atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
        var active = null;
        for (var i = 0; i < items.length; i++) {
            if (atBottom || items[i].heading.getBoundingClientRect().top <= OFFSET) {
                active = items[i].link;
            }
        }
        if (current === active) return;
        if (current) current.classList.remove('active');
        current = active;
        if (current) {
            current.classList.add('active');
            keepVisible(current);
        }
    }

    var ticking = false;
    window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
            refresh();
            ticking = false;
        });
    }, { passive: true });

    window.addEventListener('resize', function () { refresh(); });
    window.addEventListener('load', function () { refresh(); });
    refresh();
})();
