(function (ns) {
    'use strict';

    const CONFIG = ns.CONFIG;
    const objects = ns.objects = ns.objects || {};

    class StarPool {
        constructor(scene, options) {
            const opts = options || {};
            this.size = opts.size || CONFIG.STAR_POOL_SIZE;
            this.level = opts.level;
            this.created = 0;
            this.free = [];
            this.active = [];

            for (let i = 0; i < this.size; i++) {
                this.created++;
                this.free.push(new objects.Star(scene, this.level, opts.trail));
            }
        }

        // keys 是这颗星的**键序内容**（键位方案一串键：单颗星一个、双星两个 5d；单元方案一组读音，
        // 单读音字一条、多音字多条 9g），face 是显示面（缺参 = 星面就是键本身），
        // spec 是 STAR_TYPES 里的那一行，都由生成侧决定（5a）；缺参时 Star 自己回落普通星
        acquire(keys, x, speed, spec, face) {
            const star = this.free.pop();
            // 池空就跳过这一次生成，不动态扩容——扩容会让 GC 尖峰回到运行时
            if (!star) { return null; }
            this.active.push(star);
            return star.spawn(keys, x, speed, spec, face);
        }

        release(star) {
            const index = this.active.indexOf(star);
            if (index === -1) { return false; }
            this.active.splice(index, 1);
            star.despawn();
            this.free.push(star);
            return true;
        }

        releaseAll() {
            while (this.active.length) {
                this.release(this.active[this.active.length - 1]);
            }
        }

        stats() {
            return { active: this.active.length, free: this.free.length, created: this.created };
        }
    }

    objects.StarPool = StarPool;
})(window.ShootingStars = window.ShootingStars || {});