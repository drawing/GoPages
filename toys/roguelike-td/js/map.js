// 地图生成：蛇形往返路径（serpentine），强制填满全图、多转弯、可建造区均匀分布
// 解决旧版"随机走"导致的一半空一半挤问题

const MapGen = {
  generate(cols, rows) {
    const grid = []; // 0=grass, 1=path, 2=buildable, 3=decoration
    for (let y = 0; y < rows; y++) grid.push(new Array(cols).fill(0));

    // 1) 计算横向 pass 的行号：从第 1 行开始，间距 >= 2，尽量填满到 rows-2
    const passRows = [];
    let r = 1;
    while (r <= rows - 2) {
      passRows.push(r);
      r += 2 + (Math.random() < 0.3 ? 1 : 0); // 偶尔间距 3，增加变化
    }
    if (passRows.length < 2) {
      // 地图太矮时兜底
      passRows.length = 0;
      passRows.push(1, Math.max(3, rows - 2));
    }

    const path = [];
    const setPath = (x, y) => {
      if (x < 0 || x >= cols || y < 0 || y >= rows) return;
      if (grid[y][x] !== 1) { grid[y][x] = 1; path.push({ x, y }); }
    };

    // 2) 逐趟铺设横向路径 + 边缘竖向连接
    for (let i = 0; i < passRows.length; i++) {
      const row = passRows[i];
      const ltr = (i % 2 === 0); // 偶数趟从左到右
      if (ltr) {
        for (let x = 0; x < cols; x++) setPath(x, row);
      } else {
        for (let x = cols - 1; x >= 0; x--) setPath(x, row);
      }
      // 连接到下一趟：在当前趟结束的那一侧边缘竖直下行
      if (i < passRows.length - 1) {
        const nextRow = passRows[i + 1];
        const connCol = ltr ? cols - 1 : 0;
        for (let y = row + 1; y <= nextRow; y++) setPath(connCol, y);
      }
    }

    // 3) 标记可建造区：路径的四邻接格
    const buildable = new Set();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== 1) continue;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          if (grid[ny][nx] === 1) continue;
          grid[ny][nx] = 2;
          buildable.add(`${nx},${ny}`);
        }
      }
    }

    // 4) 把一小部分可建造格随机还原成装饰，增加视觉层次（保留大部分可建造）
    for (const key of [...buildable]) {
      if (Math.random() < 0.1) {
        const [x, y] = key.split(',').map(Number);
        grid[y][x] = 3;
        buildable.delete(key);
      }
    }

    // 5) 剩余纯草地随机点缀装饰
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] === 0 && Math.random() < 0.25) grid[y][x] = 3;
      }
    }

    return {
      grid, path, buildable, cols, rows,
      start: path[0],
      end: path[path.length - 1],
    };
  },

  // 把网格路径转成像素坐标（tile 中心）
  pathToPixels(path, tile) {
    return path.map(p => ({ x: p.x * tile + tile / 2, y: p.y * tile + tile / 2 }));
  }
};
