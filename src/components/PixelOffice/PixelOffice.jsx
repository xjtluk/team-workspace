import { useRef, useEffect } from 'preact/hooks';
import { CCLAWD_GRID, MARVIS_GRID, COLOR_MAP, GRID_REGISTRY } from '../../grids/CharacterGrids.js';
import './PixelOffice.css';

const CELL_SIZE = 6;
const CANVAS_W = 800;
const CANVAS_H = 500;

// 区域坐标（角色停留点）
const LOCATIONS = {
  desk: { x: 340, y: 200 },
  sofa: { x: 120, y: 340 },
  bug:  { x: 580, y: 340 },
};

// 角色状态机
const CHAR_STATES = {
  idle:     { anim: 'char-idle',     speed: 0 },
  working:  { anim: 'char-working',  speed: 0 },
  talking:  { anim: 'char-talking',  speed: 0 },
  walking:  { anim: 'char-walking',  speed: 120 }, // px/s
  error:    { anim: 'char-error',    speed: 0 },
  offline:  { anim: 'char-offline',  speed: 0 },
};

// 内部角色动画状态
const charAnimState = {};

function getCharState(agentId) {
  if (!charAnimState[agentId]) {
    charAnimState[agentId] = {
      x: LOCATIONS.sofa.x,
      y: LOCATIONS.sofa.y,
      targetX: LOCATIONS.sofa.x,
      targetY: LOCATIONS.sofa.y,
      status: 'offline',
      isMoving: false,
      facingRight: true,
      bobPhase: 0,
    };
  }
  return charAnimState[agentId];
}

function updateCharState(agentId, agent, dt) {
  const cs = getCharState(agentId);

  // 状态变更 → 更新目标位置
  if (agent.status !== cs.status || agent.location !== cs._location) {
    cs.status = agent.status;
    cs._location = agent.location;
    const target = LOCATIONS[agent.location] || LOCATIONS.sofa;
    cs.targetX = target.x;
    cs.targetY = target.y;
  }

  // 移动逻辑
  const dx = cs.targetX - cs.x;
  const dy = cs.targetY - cs.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 2) {
    cs.isMoving = true;
    const speed = CHAR_STATES.walking.speed;
    const step = speed * dt;
    if (step >= dist) {
      cs.x = cs.targetX;
      cs.y = cs.targetY;
      cs.isMoving = false;
    } else {
      cs.x += (dx / dist) * step;
      cs.y += (dy / dist) * step;
    }
    cs.facingRight = dx > 0;
  } else {
    cs.isMoving = false;
  }

  // 动画相位
  cs.bobPhase += dt * (cs.status === 'working' ? 8 : cs.status === 'talking' ? 10 : cs.status === 'error' ? 15 : 2);
}

export function PixelOffice({ agents }) {
  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const agentsRef = useRef(agents);
  const lastTimeRef = useRef(0);

  agentsRef.current = agents;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const gameLoop = (timestamp) => {
      const dt = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0.016;
      lastTimeRef.current = timestamp;

      const currentAgents = agentsRef.current;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      drawBackground(ctx);

      // 更新并渲染角色
      Object.values(currentAgents).forEach(agent => {
        if (!agent || !agent.id) return; // 防护：跳过无效 agent
        if (agent.id === 'kk') return; // KK 不渲染像素角色
        const grid = GRID_REGISTRY[agent.id];
        if (!grid) return;

        updateCharState(agent.id, agent, dt);
        const cs = getCharState(agent.id);

        // 离线且不在移动中 → 半透明
        const alpha = (agent.status === 'offline' && !cs.isMoving) ? 0.4 : 1;
        ctx.globalAlpha = alpha;

        drawCharacter(ctx, grid, cs.x, cs.y, cs);
        drawBubble(ctx, agent, cs.x, cs.y - 40);

        ctx.globalAlpha = 1;
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoop(0);
    return () => cancelAnimationFrame(gameLoopRef.current);
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} class="pixel-canvas" />;
}

// ──────────────────────── 背景绘制 ────────────────────────

function drawBackground(ctx) {
  // 深色地板
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 地板格子纹理
  ctx.fillStyle = '#0f0f1f';
  for (let x = 0; x < CANVAS_W; x += 40) {
    for (let y = 120; y < CANVAS_H; y += 40) {
      if ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0) {
        ctx.fillRect(x, y, 40, 40);
      }
    }
  }

  // 墙壁
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, CANVAS_W, 120);

  // 墙壁装饰线
  ctx.fillStyle = '#252540';
  ctx.fillRect(0, 118, CANVAS_W, 2);

  // 窗户
  drawWindow(ctx, 400, 20, 120, 80);

  // 挂画
  drawPainting(ctx, 180, 25, 60, 50);
  drawPainting(ctx, 620, 25, 50, 45);

  // ── 工作区 ──
  drawDesk(ctx, 280, 165, 200, 70);

  // ── 休息区（沙发）──
  drawSofa(ctx, 50, 310, 180, 60);

  // ── 调试区 ──
  drawDebugStation(ctx, 520, 310, 160, 60);

  // 绿植
  drawPlant(ctx, 250, 280);
  drawPlant(ctx, 700, 280);

  // 区域标签
  ctx.font = '8px "Press Start 2P"';
  ctx.fillStyle = '#555';
  ctx.fillText('WORKSPACE', 320, 155);
  ctx.fillText('LOUNGE', 85, 300);
  ctx.fillText('DEBUG', 560, 300);
}

function drawWindow(ctx, x, y, w, h) {
  // 窗框
  ctx.fillStyle = '#3d3d5c';
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  // 窗户玻璃 — 夜景
  ctx.fillStyle = '#0a0a2a';
  ctx.fillRect(x, y, w, h);
  // 星星
  ctx.fillStyle = '#ffffff';
  const stars = [[10, 12], [35, 8], [60, 20], [85, 10], [20, 35], [70, 30], [45, 42]];
  stars.forEach(([sx, sy]) => {
    ctx.fillRect(x + sx, y + sy, 2, 2);
  });
  // 月亮
  ctx.fillStyle = '#FFE4B5';
  ctx.beginPath();
  ctx.arc(x + 95, y + 18, 8, 0, Math.PI * 2);
  ctx.fill();
  // 城市剪影
  ctx.fillStyle = '#151530';
  const buildings = [
    [0, 55, 15, 25], [18, 48, 12, 32], [33, 52, 20, 28],
    [56, 45, 14, 35], [73, 50, 18, 30], [94, 55, 16, 25],
    [113, 48, 7, 32],
  ];
  buildings.forEach(([bx, by, bw, bh]) => {
    ctx.fillRect(x + bx, y + by, bw, bh);
    // 窗户灯光
    ctx.fillStyle = '#FFE4B5';
    for (let wy = y + by + 4; wy < y + by + bh - 4; wy += 8) {
      for (let wx = x + bx + 3; wx < x + bx + bw - 3; wx += 6) {
        if (Math.random() > 0.4) {
          ctx.fillRect(wx, wy, 2, 3);
        }
      }
    }
    ctx.fillStyle = '#151530';
  });
  // 窗框十字
  ctx.fillStyle = '#3d3d5c';
  ctx.fillRect(x + w / 2 - 1, y, 2, h);
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
}

function drawPainting(ctx, x, y, w, h) {
  // 画框
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x, y, w, h);
  // 简单像素画 — BKS logo 风格
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 10, y + 12, 8, 8);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + w - 18, y + 12, 8, 8);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + w / 2 - 4, y + h - 18, 8, 8);
}

function drawDesk(ctx, x, y, w, h) {
  // 桌面
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x, y, w, 6);
  // 桌腿
  ctx.fillStyle = '#2d1f15';
  ctx.fillRect(x + 10, y + h, 8, 20);
  ctx.fillRect(x + w - 18, y + h, 8, 20);

  // 显示器 1
  drawMonitor(ctx, x + 30, y - 40, 60, 40);
  // 显示器 2
  drawMonitor(ctx, x + 110, y - 40, 60, 40);
  // 键盘
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 35, y + 12, 50, 12);
  ctx.fillRect(x + 115, y + 12, 50, 12);
  // 键盘按键纹理
  ctx.fillStyle = '#333';
  for (let kx = x + 37; kx < x + 83; kx += 5) {
    ctx.fillRect(kx, y + 14, 3, 3);
    ctx.fillRect(kx, y + 19, 3, 3);
  }
  for (let kx = x + 117; kx < x + 163; kx += 5) {
    ctx.fillRect(kx, y + 14, 3, 3);
    ctx.fillRect(kx, y + 19, 3, 3);
  }
  // 咖啡杯
  drawCoffeeCup(ctx, x + w - 35, y + 8);
}

function drawMonitor(ctx, x, y, w, h) {
  // 支架
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w / 2 - 4, y + h, 8, 10);
  ctx.fillRect(x + w / 2 - 12, y + h + 8, 24, 4);
  // 屏幕边框
  ctx.fillStyle = '#333';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  // 屏幕
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(x, y, w, h);
  // 屏幕内容 — 代码行
  ctx.fillStyle = '#4A90D9';
  const lines = [
    [4, 6, 20], [4, 14, 35], [4, 22, 15], [4, 30, 28],
  ];
  lines.forEach(([lx, ly, lw]) => {
    ctx.fillRect(x + lx, y + ly, lw, 3);
  });
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 4, y + 14, 8, 3);
  // 屏幕光晕
  ctx.fillStyle = 'rgba(74, 144, 217, 0.05)';
  ctx.fillRect(x - 5, y + h + 14, w + 10, 30);
}

function drawCoffeeCup(ctx, x, y) {
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x, y, 10, 12);
  ctx.fillStyle = '#6B3A2A';
  ctx.fillRect(x + 1, y + 1, 8, 6);
  // 杯把
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 10, y + 3, 4, 2);
  ctx.fillRect(x + 12, y + 3, 2, 6);
  ctx.fillRect(x + 10, y + 7, 4, 2);
  // 蒸汽
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x + 3, y - 4, 2, 3);
  ctx.fillRect(x + 6, y - 6, 2, 5);
}

function drawSofa(ctx, x, y, w, h) {
  // 沙发靠背
  ctx.fillStyle = '#2d1f3d';
  ctx.fillRect(x, y - 15, w, 15);
  // 沙发座位
  ctx.fillStyle = '#3d2f4d';
  ctx.fillRect(x, y, w, h);
  // 沙发靠垫
  ctx.fillStyle = '#4d3f5d';
  ctx.fillRect(x + 10, y + 5, 35, 25);
  ctx.fillRect(x + w - 45, y + 5, 35, 25);
  // 沙发扶手
  ctx.fillStyle = '#2d1f3d';
  ctx.fillRect(x - 8, y - 5, 10, h + 10);
  ctx.fillRect(x + w - 2, y - 5, 10, h + 10);
  // 小茶几
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x + w / 2 - 20, y + h + 10, 40, 8);
  ctx.fillStyle = '#2d1f15';
  ctx.fillRect(x + w / 2 - 16, y + h + 18, 6, 12);
  ctx.fillRect(x + w / 2 + 10, y + h + 18, 6, 12);
}

function drawDebugStation(ctx, x, y, w, h) {
  // 调试台
  ctx.fillStyle = '#3d1f1f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#4d2f2f';
  ctx.fillRect(x, y, w, 6);
  // 桌腿
  ctx.fillStyle = '#2d1515';
  ctx.fillRect(x + 10, y + h, 8, 20);
  ctx.fillRect(x + w - 18, y + h, 8, 20);
  // 错误监视器
  drawMonitor(ctx, x + 50, y - 40, 60, 40);
  // Bug 标志 — 像素虫子
  drawBugIcon(ctx, x + 10, y + 12);
  // 红牛罐
  drawRedBull(ctx, x + w - 25, y + 10);
}

function drawBugIcon(ctx, x, y) {
  ctx.fillStyle = '#F56C6C';
  // 身体
  ctx.fillRect(x + 4, y, 6, 8);
  // 腿
  ctx.fillRect(x, y + 2, 2, 2);
  ctx.fillRect(x + 12, y + 2, 2, 2);
  ctx.fillRect(x + 1, y + 5, 2, 2);
  ctx.fillRect(x + 11, y + 5, 2, 2);
  // 触角
  ctx.fillRect(x + 3, y - 2, 2, 2);
  ctx.fillRect(x + 9, y - 2, 2, 2);
}

function drawRedBull(ctx, x, y) {
  ctx.fillStyle = '#1a1aff';
  ctx.fillRect(x, y, 8, 14);
  ctx.fillStyle = '#ff4444';
  ctx.fillRect(x + 1, y + 2, 6, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 2, y + 3, 4, 2);
}

function drawPlant(ctx, x, y) {
  // 花盆
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x, y + 15, 18, 15);
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x - 2, y + 13, 22, 4);
  // 叶子
  ctx.fillStyle = '#2d8b4a';
  ctx.fillRect(x + 5, y, 8, 14);
  ctx.fillRect(x - 2, y + 4, 8, 6);
  ctx.fillRect(x + 12, y + 4, 8, 6);
  ctx.fillStyle = '#3daa5a';
  ctx.fillRect(x + 6, y + 2, 6, 8);
}

// ──────────────────────── 角色绘制 ────────────────────────

function drawCharacter(ctx, grid, x, y, charState) {
  ctx.save();

  // 水平翻转（朝左）
  if (!charState.facingRight) {
    const charW = grid[0].length * CELL_SIZE;
    ctx.translate(x + charW, y);
    ctx.scale(-1, 1);
    x = 0;
    y = 0;
  }

  // 动画偏移
  let offsetX = 0;
  let offsetY = 0;
  const phase = charState.bobPhase;

  if (charState.isMoving) {
    // 行走弹跳
    offsetY = Math.sin(phase * 4) * 3;
  } else if (charState.status === 'idle') {
    // 缓慢浮动
    offsetY = Math.sin(phase) * 2;
  } else if (charState.status === 'working') {
    // 快速浮动
    offsetY = Math.sin(phase) * 2;
  } else if (charState.status === 'talking') {
    // 左右微晃已通过 CSS，这里加轻微上下
    offsetY = Math.sin(phase * 1.5) * 1;
  } else if (charState.status === 'error') {
    // 抖动
    offsetX = Math.sin(phase * 2) * 2;
  }

  // 渲染像素网格
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const val = grid[row][col];
      if (val === 0) continue;
      ctx.fillStyle = COLOR_MAP[val];
      ctx.fillRect(
        x + offsetX + col * CELL_SIZE,
        y + offsetY + row * CELL_SIZE,
        CELL_SIZE,
        CELL_SIZE
      );
    }
  }

  ctx.restore();
}

// ──────────────────────── 气泡绘制 ────────────────────────

const BUBBLE_ICONS = {
  working:  '⚙',  // ⚙
  talking:  '💬',  // 💬
  error:    '🐛',  // 🐛
  idle:     '💤',  // 💤
};

const BUBBLE_COLORS = {
  working:  { bg: '#1a2a3a', border: '#4A90D9' },
  talking:  { bg: '#1a3a1a', border: '#67C23A' },
  error:    { bg: '#3a1a1a', border: '#F56C6C' },
  idle:     { bg: '#2a2a2a', border: '#909399' },
};

function drawBubble(ctx, agent, x, y) {
  if (!agent.activity && agent.status !== 'offline') return;

  const text = agent.status === 'offline' ? 'offline' : agent.activity;
  if (!text) return;

  const icon = BUBBLE_ICONS[agent.status] || BUBBLE_ICONS.idle;
  const colors = BUBBLE_COLORS[agent.status] || BUBBLE_COLORS.idle;
  const displayText = `${icon} ${text}`;

  ctx.font = '8px "Press Start 2P"';
  const textWidth = ctx.measureText(displayText).width;
  const bubbleW = Math.max(textWidth + 20, 60);
  const bubbleH = 22;
  const bx = x - bubbleW / 2 + 30;
  const by = y;

  // 气泡背景
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, bubbleW, bubbleH, 4);
  ctx.fill();
  ctx.stroke();

  // 小三角指向角色
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.moveTo(bx + bubbleW / 2 - 5, by + bubbleH);
  ctx.lineTo(bx + bubbleW / 2, by + bubbleH + 6);
  ctx.lineTo(bx + bubbleW / 2 + 5, by + bubbleH);
  ctx.fill();

  // 文字
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(displayText, bx + 10, by + 15);

  // 进度条（仅 working 状态且 progress > 0）
  if (agent.status === 'working' && agent.progress > 0) {
    const barW = bubbleW - 20;
    const barX = bx + 10;
    const barY = by + bubbleH + 10;
    // 背景
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, 4);
    // 进度
    ctx.fillStyle = '#67C23A';
    ctx.fillRect(barX, barY, barW * (agent.progress / 100), 4);
    // 边框
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, 4);
  }
}
