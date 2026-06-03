import { useRef, useEffect } from 'preact/hooks';
import { CCLAWD_GRID, MARVIS_GRID, COLOR_MAP, GRID_REGISTRY } from '../../grids/CharacterGrids.js';
import './PixelOffice.css';

const CELL_SIZE = 5;
const CANVAS_W = 960;
const CANVAS_H = 580;
const MAX_DT = 0.05; // delta time 上限，防止帧率波动导致瞬移

// ═══════════════════════ 缓动函数库 ═══════════════════════
const EASING = {
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOutCubic:  t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack:   t => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  easeOutElastic: t => { if (t === 0 || t === 1) return t; return Math.pow(2, -10 * t) * Math.sin((t - 1) * (2 * Math.PI) / 0.3) + 1; },
  linear:        t => t,
};

// ═══════════════════════ 办公室布局坐标 ═══════════════════════
// ┌──────────────────────────────────────────────────────────┐
// │  🍳 KITCHEN  │ CC R&D │ 空工位A │ 空工位B │ 小马 PM │空C │
// │  咖啡机杯子  │ 双屏   │ 单屏   │ 单屏   │ 宽屏   │单屏 │
// ├──────────────┴────────┴────────┴────────┴────────┴─────┤
// │  🏃 跑步机   │ 空工位D │ 空工位E │ [白板] │空F│空G│仓库 │
// ├──────────────┴────────┴────────┴────────┴────┴────┴─────┤
// │  🚻 卫生间   │   🛋️ 休息区    │ 📚 书架 │饮水机│ 🌿  │
// └──────────────────────────────────────────────────────────┘

// ── 角色工位坐标（站在桌子前方居中）──
const LOCATIONS = {
  cc_desk:  { x: 240, y: 256 },    // CC R&D — 双屏桌前（桌心237）
  cx_desk:  { x: 545, y: 256 },    // CX DEV — 空工位B（桌心542）
  xm_desk:  { x: 710, y: 256 },    // 小马 PM — 宽屏桌前（桌心702）
};

// 角色默认「家」
const HOME_LOCATIONS = {
  cc: 'cc_desk',
  cx: 'cx_desk',
  xm: 'xm_desk',
};

// 笔记本在桌面上的位置（微调坐标，修正偏移）
const LAPTOP_POSITIONS = {
  cc_desk: { x: 178, y: 162 },
  cx_desk: { x: 483, y: 162 },
  xm_desk: { x: 678, y: 162 },
};

// 工作状态笔记本动画计时器
const laptopAnimTimers = {};

// 角色状态机
const CHAR_STATES = {
  idle:     { anim: 'char-idle',     speed: 0 },
  working:  { anim: 'char-working',  speed: 0 },
  talking:  { anim: 'char-talking',  speed: 0 },
  walking:  { anim: 'char-walking',  speed: 120 },
  error:    { anim: 'char-error',    speed: 0 },
  offline:  { anim: 'char-offline',  speed: 0 },
};

const charAnimState = {};

// 空闲散步目标点（走廊、白板前等公共区域）
const WANDER_POINTS = [
  { x: 200, y: 360 },
  { x: 480, y: 370 },  // 白板前走廊
  { x: 720, y: 360 },
  { x: 300, y: 460 },  // 休息区走廊
  { x: 600, y: 460 },
];

function getCharState(agentId) {
  if (!charAnimState[agentId]) {
    const homeLoc = HOME_LOCATIONS[agentId] || 'xm_desk';
    const home = LOCATIONS[homeLoc];
    charAnimState[agentId] = {
      x: home.x, y: home.y,
      moveStartX: home.x, moveStartY: home.y,
      moveTargetX: home.x, moveTargetY: home.y,
      moveProgress: 1, moveDuration: 1,
      prevStatus: 'offline',
      status: 'offline', isMoving: false,
      facingRight: agentId === 'cc' ? false : true,
      bobPhase: 0,
      stateBlend: 1, // 状态过渡混合 (0→1)
    };
  }
  return charAnimState[agentId];
}

function updateCharState(agentId, agent, dt, allAgents) {
  const cs = getCharState(agentId);
  const homeLoc = HOME_LOCATIONS[agentId] || 'xm_desk';
  const home = LOCATIONS[homeLoc];
  const rawLocation = agent.location || homeLoc;
  const effectiveLocation = LOCATIONS[rawLocation] ? rawLocation : homeLoc;
  const speed = CHAR_STATES.walking.speed;

  // ── 状态过渡检测 ──
  if (cs.status !== agent.status) {
    cs.prevStatus = cs.status;
    cs.status = agent.status;
    cs.stateBlend = 0; // 启动状态过渡
  }
  // 状态过渡平滑混合
  if (cs.stateBlend < 1) {
    cs.stateBlend = Math.min(1, cs.stateBlend + dt * 4);
  }

  // ── 工作状态：走向工位 ──
  if (agent.status === 'working') {
    cs._location = effectiveLocation;
    const distToDesk = Math.sqrt((cs.x - home.x) ** 2 + (cs.y - home.y) ** 2);
    if (distToDesk > 5) {
      startTweenMove(cs, home.x, home.y, speed);
    } else {
      cs.isMoving = false;
      cs.moveProgress = 1;
      cs.x = home.x; cs.y = home.y;
    }
    cs.bobPhase += dt * 8;
    return;
  }

  // ── 空闲 / 离线 ──
  if (agent.status === 'idle' || agent.status === 'offline') {
    if (cs.prevStatus === 'working') { cs._idleTimer = 0; cs._returnTimer = 0; }
    cs._location = effectiveLocation;
    if (!cs._idleTimer) cs._idleTimer = 0;

    // 刚离开工作状态，先在原位停留片刻
    if (!cs._returnTimer) cs._returnTimer = 0;
    cs._returnTimer += dt;
    if (cs._returnTimer < 1.5) {
      cs.isMoving = false;
      cs.bobPhase += dt * 2;
      return;
    }

    cs._idleTimer += dt;

    const distToTarget = Math.sqrt((cs.x - cs.moveTargetX) ** 2 + (cs.y - cs.moveTargetY) ** 2);
    if (distToTarget < 5) {
      cs.isMoving = false;
      cs.moveProgress = 1;
      if (cs._idleTimer > (2 + Math.random() * 3)) {
        cs._idleTimer = 0;
        const candidates = WANDER_POINTS.filter(p =>
          Math.sqrt((p.x - home.x) ** 2 + (p.y - home.y) ** 2) > 80
        );
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || WANDER_POINTS[0];
        startTweenMove(cs,
          pick.x + (Math.random() - 0.5) * 40,
          pick.y + (Math.random() - 0.5) * 20,
          speed * 0.6 // 散步稍慢
        );
      }
    } else {
      cs.isMoving = true;
    }
  }

  // ── 缓动移动计算 ──
  applyTweenMove(cs, dt);

  cs.bobPhase += dt * (
    cs.status === 'working' ? 8 :
    cs.status === 'talking' ? 10 :
    cs.status === 'error'   ? 15 : 2
  );
}

// ═══════════════════════ Tween 移动系统 ═══════════════════════
function startTweenMove(cs, tx, ty, speed) {
  const dx = tx - cs.x;
  const dy = ty - cs.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  cs.moveStartX = cs.x;
  cs.moveStartY = cs.y;
  cs.moveTargetX = tx;
  cs.moveTargetY = ty;
  cs.moveProgress = 0;
  cs.moveDuration = Math.max(0.3, dist / speed); // 最少 0.3s
  cs.isMoving = true;
  cs.facingRight = dx > 0;
}

function applyTweenMove(cs, dt) {
  if (!cs.isMoving) return;
  cs.moveProgress += dt / cs.moveDuration;
  if (cs.moveProgress >= 1) {
    cs.x = cs.moveTargetX;
    cs.y = cs.moveTargetY;
    cs.isMoving = false;
    cs.moveProgress = 1;
  } else {
    const t = EASING.easeInOutQuad(cs.moveProgress);
    cs.x = cs.moveStartX + (cs.moveTargetX - cs.moveStartX) * t;
    cs.y = cs.moveStartY + (cs.moveTargetY - cs.moveStartY) * t;
  }
}

export function PixelOffice({ agents }) {
  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const agentsRef = useRef(agents);
  const lastTimeRef = useRef(0);
  const bgCanvasRef = useRef(null);
  agentsRef.current = agents;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // ── 预渲染静态背景到离屏 Canvas ──
    if (!bgCanvasRef.current) {
      const bg = document.createElement('canvas');
      bg.width = CANVAS_W;
      bg.height = CANVAS_H;
      const bgCtx = bg.getContext('2d');
      bgCtx.imageSmoothingEnabled = false;
      drawBackground(bgCtx);
      bgCanvasRef.current = bg;
    }

    const gameLoop = (timestamp) => {
      let dt = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0.016;
      dt = Math.min(dt, MAX_DT); // 帧率保护，防止卡帧后瞬移
      lastTimeRef.current = timestamp;

      const currentAgents = agentsRef.current;

      // 绘制预渲染背景（性能优化：不再逐帧重绘复杂背景）
      ctx.drawImage(bgCanvasRef.current, 0, 0);

      Object.values(currentAgents).forEach(agent => {
        if (!agent || !agent.id) return;
        if (agent.id === 'kk') return;
        const grid = GRID_REGISTRY[agent.id];
        if (!grid) return;

        updateCharState(agent.id, agent, dt, currentAgents);
        const cs = getCharState(agent.id);

        const alpha = (agent.status === 'offline' && !cs.isMoving) ? 0.4 : 1;
        ctx.globalAlpha = alpha;
        drawCharacter(ctx, grid, cs.x, cs.y, cs);

        if (agent.status === 'working') {
          const homeKey = HOME_LOCATIONS[agent.id] || 'xm_desk';
          drawLaptopOnDesk(ctx, homeKey);
        }

        drawBubble(ctx, agent, cs.x, cs.y - 70);
        ctx.globalAlpha = 1;
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    gameLoop(0);
    return () => cancelAnimationFrame(gameLoopRef.current);
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} class="pixel-canvas" />;
}

// ═══════════════════════════════════════════════════════════
//  背景绘制 — Marvis 风格多层办公室
// ═══════════════════════════════════════════════════════════

function drawBackground(ctx) {
  // ── 地板 ──
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 地板格子纹理（大格子）
  ctx.fillStyle = '#101022';
  for (let x = 0; x < CANVAS_W; x += 40) {
    for (let y = 140; y < CANVAS_H; y += 40) {
      if ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0) {
        ctx.fillRect(x, y, 40, 40);
      }
    }
  }

  // ── 墙壁（加高）──
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, CANVAS_W, 140);
  ctx.fillStyle = '#252540';
  ctx.fillRect(0, 138, CANVAS_W, 2);

  // ── 天花板灯条 ──
  drawCeilingLights(ctx);

  // ── 中央大窗 ──
  drawWindow(ctx, 410, 20, 140, 90);

  // ── 墙面标牌 ──
  drawSign(ctx, 15, 12, 130, 30, 'KITCHEN', '#E6A23C');
  drawSign(ctx, 160, 12, 130, 30, 'R&D DEPT', '#4A90D9');
  drawSign(ctx, 620, 12, 130, 30, 'PM DEPT', '#67C23A');
  drawSign(ctx, 800, 12, 80, 30, 'L3', '#909399');

  // ── 时钟 ──
  drawClock(ctx, 300, 15);

  // ═══════════ row-1: 工位行 (y≈148~230) ═══════════
  drawKitchen(ctx, 8, 148, 140, 84);
  drawDesk(ctx, 155, 150, 165, 'dual',  'R&D');      // CC 双屏工位
  drawDesk(ctx, 330, 150, 135, 'basic', null);        // 空工位A
  drawDesk(ctx, 475, 150, 135, 'basic', 'CX');         // CX DEV 工位
  drawDesk(ctx, 620, 150, 165, 'wide',  'PM');        // 小马 宽屏工位
  drawDesk(ctx, 795, 150, 135, 'basic', null);        // 空工位C

  // ═══════════ row-2: 工位 + 功能区 (y≈268~425) ═══════════
  drawTreadmill(ctx, 10, 272, 98, 95);
  drawDesk(ctx, 120, 280, 145, 'basic', null);        // 空工位D
  drawDesk(ctx, 275, 280, 145, 'basic', null);        // 空工位E
  drawCenterPillar(ctx, 430, 285, 60, 95);            // 白板柱 + 盆栽
  drawDesk(ctx, 500, 280, 145, 'basic', null);        // 空工位F
  drawDesk(ctx, 655, 280, 145, 'basic', null);        // 空工位G
  drawSupplyShelf(ctx, 812, 272, 110, 85);            // 仓库架

  // ═══════════ row-3: 底部生活区 (y≈440~570) ═══════════
  drawRestroom(ctx, 10, 442, 130, 118);
  drawLounge(ctx, 158, 450, 210, 103);                // 休息区
  drawBookshelf(ctx, 385, 448, 75, 105);              // 书架
  drawWaterDispenser(ctx, 478, 465);                   // 饮水机

  // ── 散落绿植 ──
  drawPlant(ctx, 500, 510);
  drawPlant(ctx, 680, 515);
  drawPlant(ctx, 860, 510);
  drawPlant(ctx, 880, 420);
  drawPlant(ctx, 920, 320);
}

// ═══════════════════════ 墙面元素 ═══════════════════════

function drawCeilingLights(ctx) {
  ctx.fillStyle = 'rgba(255,255,200,0.06)';
  for (let lx = 60; lx < CANVAS_W; lx += 160) {
    ctx.fillRect(lx, 0, 60, 8);
    // 灯光渐变
    ctx.fillStyle = 'rgba(255,255,200,0.03)';
    ctx.fillRect(lx + 2, 8, 56, 20);
    ctx.fillStyle = 'rgba(255,255,200,0.06)';
  }
}

function drawSign(ctx, x, y, w, h, text, accentColor) {
  ctx.fillStyle = '#1e1e36';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
  ctx.strokeStyle = accentColor; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.stroke();

  ctx.fillStyle = accentColor;
  ctx.fillRect(x + 8, y + h - 4, w - 16, 1.5);

  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = accentColor;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 18);
  ctx.textAlign = 'start';
}

function drawClock(ctx, x, y) {
  ctx.fillStyle = '#f5f0e9';
  ctx.beginPath(); ctx.arc(x + 20, y + 16, 14, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x + 20, y + 16, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 19, y + 10, 2, 8);   // 时针
  ctx.fillRect(x + 20, y + 7, 2, 10);   // 分针
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 19, y + 16, 2, 4);   // 秒针红色
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x + 20, y + 16, 1.5, 0, Math.PI * 2); ctx.fill();
}

// ═══════════════════════ 厨房 ═══════════════════════

function drawKitchen(ctx, x, y, w, h) {
  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + h, w + 4, 8);

  // 灶台面
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(x, y + 14, w, h - 14);
  ctx.fillStyle = '#4a4a5a';
  ctx.fillRect(x, y + 14, w, 5);

  // 贴墙背板
  ctx.fillStyle = '#E6D5B8';
  ctx.fillRect(x + 4, y + 5, w - 8, 16);
  // 瓷砖线
  ctx.fillStyle = '#D4C3A8';
  ctx.fillRect(x + 4, y + 13, w - 8, 1);
  ctx.fillRect(x + w / 2, y + 5, 1, 16);

  // 咖啡机
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 10, y + 24, 28, 28);
  ctx.fillStyle = '#888';
  ctx.fillRect(x + 12, y + 26, 24, 12);
  // 咖啡出口
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 22, y + 38, 4, 8);
  ctx.fillRect(x + 18, y + 46, 12, 2);
  // 蒸汽口
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 34, y + 24, 2, 6);
  // 按钮指示灯
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 14, y + 28, 2, 2);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 14, y + 32, 2, 2);

  // 一排咖啡杯（6个）
  for (let ci = 0; ci < 6; ci++) {
    const cx = x + 52 + ci * 14;
    const cy = y + 42;
    ctx.fillStyle = '#F5E6D3';
    ctx.fillRect(cx, cy, 10, 12);
    ctx.fillStyle = '#6B3A2A';
    ctx.fillRect(cx + 2, cy + 1, 6, 4);
    ctx.fillStyle = '#F5E6D3';
    ctx.fillRect(cx + 10, cy + 3, 2, 2);
    ctx.fillRect(cx + 11, cy + 3, 2, 5);
    ctx.fillRect(cx + 10, cy + 6, 2, 2);
  }

  // 台面下水槽区
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(x + 6, y + h - 18, 30, 16);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 10, y + h - 16, 22, 2);

  // 灶台下方柜门
  ctx.fillStyle = '#5a4a3a';
  ctx.fillRect(x + 4, y + h - 20, 36, 18);
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 20, y + h - 16, 4, 10);  // 把手
}

// ═══════════════════════ 通用工位 ═══════════════════════

function drawDesk(ctx, x, y, w, type, label) {
  const h = 65;

  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 3, y + h, w + 6, 8);

  // 桌面
  if (type === 'dual') {
    ctx.fillStyle = '#3d2b1f';
  } else if (type === 'wide') {
    ctx.fillStyle = '#4a3025';
  } else {
    ctx.fillStyle = '#3a2a1a';
  }
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = type === 'dual' ? '#5c3d2e' : type === 'wide' ? '#6b4a3a' : '#4a3525';
  ctx.fillRect(x, y, w, 6);

  // 桌腿
  ctx.fillStyle = '#2d1f15';
  ctx.fillRect(x + 10, y + h, 6, 18);
  ctx.fillRect(x + w - 16, y + h, 6, 18);

  // ── 显示器 ──
  if (type === 'dual') {
    drawMonitor(ctx, x + 12, y - 38, 50, 38);
    drawMonitor(ctx, x + 70, y - 38, 50, 38);
  } else if (type === 'wide') {
    drawWideMonitor(ctx, x + 22, y - 38, 120, 38);
  } else {
    drawMonitor(ctx, x + w / 2 - 25, y - 38, 50, 38);
  }

  // ── 键盘 ──
  drawKeyboard(ctx, x + w / 2 - 30, y + 12, 60, 14);

  // ── 工位专属物品 ──
  if (type === 'dual') {
    // CC 专属: 咖啡杯 + 服务器机箱
    drawCoffeeCup(ctx, x + w - 25, y + 6);
    ctx.fillStyle = '#222';
    ctx.fillRect(x + w + 2, y + 30, 18, 28);
    ctx.fillStyle = '#333';
    ctx.fillRect(x + w + 4, y + 34, 14, 5);
    ctx.fillRect(x + w + 4, y + 44, 14, 5);
    ctx.fillStyle = '#4A90D9';
    ctx.fillRect(x + w + 14, y + 35, 2, 2);
    ctx.fillStyle = '#67C23A';
    ctx.fillRect(x + w + 14, y + 45, 2, 2);
    // 便签
    ctx.fillStyle = '#FFFDE7';
    ctx.fillRect(x + 68, y - 34, 10, 10);
    ctx.fillStyle = '#FFC107';
    ctx.fillRect(x + 70, y - 33, 6, 2);

  } else if (type === 'wide') {
    // 小马专属: 笔记本 + 马克杯
    ctx.fillStyle = '#2c1810';
    ctx.fillRect(x + 8, y + 8, 16, 12);
    ctx.fillStyle = '#f5f0e9';
    ctx.fillRect(x + 9, y + 9, 14, 10);
    ctx.fillStyle = '#a0d0e0';
    ctx.fillRect(x + 11, y + 12, 10, 1);
    ctx.fillRect(x + 11, y + 15, 6, 1);
    // 笔
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 20, y + 2, 2, 14);
    ctx.fillStyle = '#E84040';
    ctx.fillRect(x + 20, y, 2, 4);

    ctx.fillStyle = '#F5E6D3';
    ctx.fillRect(x + w - 22, y + 6, 10, 12);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x + w - 21, y + 7, 8, 5);
    ctx.fillStyle = '#F5E6D3';
    ctx.fillRect(x + w - 12, y + 9, 2, 2);
    ctx.fillRect(x + w - 11, y + 9, 2, 5);
  }

  // 椅子（桌子前方居中）
  drawChair(ctx, x + w / 2 - 15, y + h + 4, 30, 28);

  // 如果工位有标签（没人坐，展示 "EMPTY"）
  if (label) {
    ctx.font = '6px "Press Start 2P"';
    ctx.fillStyle = type === 'dual' ? '#4A90D9' : '#67C23A';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h + 42);
    ctx.textAlign = 'start';
  }
}

// ═══════════════════════ 跑步机 ═══════════════════════

function drawTreadmill(ctx, x, y, w, h) {
  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x - 2, y + h, w + 4, 6);

  // 机器主体
  ctx.fillStyle = '#333340';
  ctx.fillRect(x + 4, y + 10, w - 8, h - 12);
  ctx.fillStyle = '#444455';
  ctx.fillRect(x + 4, y + 10, w - 8, 6);

  // 跑带
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 8, y + 30, w - 16, h - 45);
  // 跑带纹理
  ctx.fillStyle = '#222';
  for (let bx = x + 10; bx < x + w - 16; bx += 8) {
    ctx.fillRect(bx, y + 32, 4, h - 49);
  }

  // 前支柱 + 控制面板
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 12, y + 16, 4, 18);
  ctx.fillRect(x + w - 16, y + 16, 4, 18);
  ctx.fillStyle = '#667';
  ctx.fillRect(x + 6, y + 6, w - 12, 12);
  // 屏幕
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(x + 22, y + 8, w - 44, 8);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 26, y + 10, 12, 4);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 42, y + 10, 8, 4);
  // 红色把手
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 8, y + 6, 6, 4);
  ctx.fillRect(x + w - 14, y + 6, 6, 4);

  // 标签
  ctx.font = '6px "Press Start 2P"';
  ctx.fillStyle = '#909399';
  ctx.textAlign = 'center';
  ctx.fillText('GYM', x + w / 2, y + h + 16);
  ctx.textAlign = 'start';
}

// ═══════════════════════ 中央白板柱 ═══════════════════════

function drawCenterPillar(ctx, x, y, w, h) {
  // 柱体
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(x, y, w, 4);

  // 白板面
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(x + 6, y + 10, w - 12, 50);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + 6, y + 10, w - 12, 50);

  // 白板上内容
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 10, y + 14, 20, 2);
  ctx.fillRect(x + 10, y + 18, 35, 2);
  ctx.fillRect(x + 10, y + 22, 12, 2);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 40, y + 14, 8, 6);
  // 方框
  ctx.strokeStyle = '#67C23A';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 10, y + 28, 28, 18);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 14, y + 32, 4, 4);

  // 底部盆栽
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x + 18, y + h - 20, 24, 14);
  ctx.fillStyle = '#2d8b4a';
  ctx.fillRect(x + 22, y + h - 40, 16, 22);
  ctx.fillStyle = '#3daa5a';
  ctx.fillRect(x + 24, y + h - 44, 12, 16);
  ctx.fillRect(x + 18, y + h - 38, 8, 10);
  ctx.fillRect(x + 34, y + h - 38, 8, 10);

  // 白板笔槽
  ctx.fillStyle = '#ccc';
  ctx.fillRect(x + 8, y + 58, w - 16, 4);
  // 笔
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 12, y + 59, 2, 6);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 18, y + 59, 2, 6);
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 24, y + 59, 2, 6);
}

// ═══════════════════════ 仓库架 ═══════════════════════

function drawSupplyShelf(ctx, x, y, w, h) {
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x, y, w, 4);

  // 隔板
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x, y + 28, w, 2);
  ctx.fillRect(x, y + 56, w, 2);

  // 上层 — 文件盒
  ctx.fillStyle = '#FFE4B5';
  ctx.fillRect(x + 6, y + 8, 22, 18);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 30, y + 8, 22, 18);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 54, y + 10, 22, 16);

  // 中层 — 箱子
  ctx.fillStyle = '#8B7355';
  ctx.fillRect(x + 8, y + 34, 30, 20);
  ctx.fillRect(x + 42, y + 36, 28, 18);
  ctx.fillRect(x + 74, y + 35, 26, 19);

  // 下层 — 卷纸/杂物
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 10, y + 62, 12, 20);
  ctx.fillRect(x + 26, y + 64, 14, 18);
  ctx.fillRect(x + 44, y + 63, 11, 19);
  ctx.fillRect(x + 59, y + 65, 13, 17);

  ctx.font = '5px "Press Start 2P"';
  ctx.fillStyle = '#909399';
  ctx.textAlign = 'center';
  ctx.fillText('SUPPLY', x + w / 2, y + h + 14);
  ctx.textAlign = 'start';
}

// ═══════════════════════ 卫生间 ═══════════════════════

function drawRestroom(ctx, x, y, w, h) {
  // 墙面背景
  ctx.fillStyle = '#d5dbe0';
  ctx.fillRect(x, y, w, h);
  // 墙下线
  ctx.fillStyle = '#b0b8c0';
  ctx.fillRect(x, y + h - 4, w, 4);

  // 门（左侧半开门）
  ctx.fillStyle = '#8B7355';
  ctx.fillRect(x + 6, y + h - 78, 50, 78);
  ctx.fillStyle = '#A0876A';
  ctx.fillRect(x + 8, y + h - 76, 46, 40);
  // 门把手
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 40, y + h - 44, 4, 8);
  // 门上标识
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#1a1a2e';
  ctx.textAlign = 'center';
  ctx.fillText('🚽', x + 30, y + h - 50);
  ctx.textAlign = 'start';

  // 马桶
  ctx.fillStyle = '#F5F5F5';
  ctx.fillRect(x + 68, y + h - 46, 25, 30);
  ctx.fillStyle = '#E8E8E8';
  ctx.fillRect(x + 70, y + h - 44, 21, 26);
  // 马桶盖
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 68, y + h - 48, 25, 6);
  ctx.fillStyle = '#bbb';
  ctx.fillRect(x + 78, y + h - 48, 16, 3);
  // 冲水按钮
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 76, y + h - 55, 8, 6);

  // 洗手台
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 100, y + h - 38, 28, 26);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(x + 102, y + h - 36, 24, 22);
  // 水龙头
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 112, y + h - 40, 4, 6);
  ctx.fillRect(x + 110, y + h - 42, 8, 4);
  // 水滴
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 114, y + h - 34, 2, 4);

  // 镜子
  ctx.fillStyle = '#c0d8f0';
  ctx.fillRect(x + 104, y + 8, 20, 24);
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 104, y + 8, 20, 24);

  ctx.font = '6px "Press Start 2P"';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.fillText('RESTROOM', x + w / 2, y + h + 14);
  ctx.textAlign = 'start';
}

// ═══════════════════════ 休息区沙发 ═══════════════════════

function drawLounge(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x - 2, y + h - 2, w + 4, 6);

  // 地毯
  ctx.fillStyle = '#3a2a4a';
  ctx.fillRect(x + 5, y + h - 30, w - 10, 26);
  ctx.fillStyle = '#4a355a';
  ctx.fillRect(x + 10, y + h - 28, w - 20, 22);
  // 地毯边饰
  ctx.fillStyle = '#6a4a7a';
  ctx.fillRect(x + 5, y + h - 30, w - 10, 2);
  ctx.fillRect(x + 5, y + h - 6, w - 10, 2);

  // L 型沙发主体
  ctx.fillStyle = '#4a3525';
  ctx.fillRect(x + 8, y + h - 70, w - 80, 48);
  ctx.fillRect(x + w - 80, y + h - 40, 72, 18);
  // 沙发背
  ctx.fillStyle = '#5a4535';
  ctx.fillRect(x + 8, y + h - 72, w - 80, 10);
  ctx.fillRect(x + w - 80, y + h - 42, 72, 8);
  // 坐垫
  ctx.fillStyle = '#6b5040';
  ctx.fillRect(x + 14, y + h - 54, 32, 26);
  ctx.fillRect(x + 52, y + h - 54, 32, 26);
  ctx.fillStyle = '#6b5040';
  ctx.fillRect(x + w - 74, y + h - 36, 30, 14);
  ctx.fillRect(x + w - 40, y + h - 36, 30, 14);

  // 靠垫
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 20, y + h - 60, 14, 10);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 58, y + h - 60, 14, 10);

  // 茶几
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x + w / 2 - 18, y + h - 14, 36, 4);
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x + w / 2 - 14, y + h - 24, 4, 12);
  ctx.fillRect(x + w / 2 + 10, y + h - 24, 4, 12);
  // 茶杯
  ctx.fillStyle = '#F5E6D3';
  ctx.fillRect(x + w / 2 - 14, y + h - 18, 8, 8);
  ctx.fillStyle = '#6B3A2A';
  ctx.fillRect(x + w / 2 - 13, y + h - 17, 6, 3);

  ctx.font = '6px "Press Start 2P"';
  ctx.fillStyle = '#909399';
  ctx.textAlign = 'center';
  ctx.fillText('LOUNGE', x + w / 2, y + h + 16);
  ctx.textAlign = 'start';
}

// ═══════════════════════ 书架 ═══════════════════════

function drawBookshelf(ctx, x, y, w, h) {
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x, y, w, 3);
  ctx.fillRect(x, y + 32, w, 2);
  ctx.fillRect(x, y + 64, w, 2);

  // 书本 — 彩色
  const books = [
    { cx: 3, cw: 14, ch: 26, color: '#4A90D9', cy: 5 },
    { cx: 19, cw: 10, ch: 24, color: '#F56C6C', cy: 7 },
    { cx: 31, cw: 16, ch: 28, color: '#67C23A', cy: 3 },
    { cx: 49, cw: 12, ch: 22, color: '#E6A23C', cy: 9 },
    { cx: 63, cw: 8, ch: 25, color: '#409EFF', cy: 6 },
    { cx: 3, cw: 18, ch: 28, color: '#8B4513', cy: 35 },
    { cx: 23, cw: 12, ch: 26, color: '#2c1810', cy: 37 },
    { cx: 37, cw: 14, ch: 30, color: '#9B59B6', cy: 33 },
    { cx: 53, cw: 10, ch: 24, color: '#E74C3C', cy: 39 },
    { cx: 65, cw: 8, ch: 27, color: '#1ABC9C', cy: 36 },
    { cx: 5, cw: 14, ch: 30, color: '#FFE4B5', cy: 67 },
    { cx: 21, cw: 16, ch: 28, color: '#D35400', cy: 69 },
    { cx: 39, cw: 10, ch: 32, color: '#2980B9', cy: 65 },
    { cx: 51, cw: 12, ch: 26, color: '#C0392B', cy: 71 },
    { cx: 65, cw: 8, ch: 29, color: '#27AE60', cy: 68 },
  ];
  books.forEach(b => {
    ctx.fillStyle = b.color;
    ctx.fillRect(x + b.cx, y + b.cy, b.cw, b.ch);
  });

  ctx.font = '5px "Press Start 2P"';
  ctx.fillStyle = '#909399';
  ctx.textAlign = 'center';
  ctx.fillText('LIBRARY', x + w / 2, y + h + 14);
  ctx.textAlign = 'start';
}

// ═══════════════════════ 饮水机 ═══════════════════════

function drawWaterDispenser(ctx, x, y) {
  // 机身
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(x, y, 24, 40);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(x + 2, y + 2, 20, 36);
  // 水桶（上面蓝色）
  ctx.fillStyle = '#b8d8f0';
  ctx.fillRect(x + 3, y - 8, 18, 14);
  ctx.fillStyle = '#c8e4f8';
  ctx.fillRect(x + 3, y - 8, 18, 4);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 3, y - 8, 18, 14);
  // 出水口
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 6, y + 16, 12, 4);
  // 龙头
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 10, y + 20, 4, 5);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 4, y + 22, 4, 5);
  // 接水盘
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 2, y + 28, 20, 4);
  // 底座
  ctx.fillStyle = '#ccc';
  ctx.fillRect(x - 1, y + 36, 26, 5);
}

// ═══════════════════════ 通用组件 ═══════════════════════

function drawWindow(ctx, x, y, w, h) {
  ctx.fillStyle = '#3d3d5c';
  ctx.fillRect(x - 4, y - 4, w + 8, h + 8);
  ctx.fillStyle = '#0a0a2a';
  ctx.fillRect(x, y, w, h);
  // 星星
  ctx.fillStyle = '#ffffff';
  const stars = [[12,14],[40,10],[65,22],[95,12],[25,40],[80,35],[50,50],[110,45],[70,65]];
  stars.forEach(([sx, sy]) => ctx.fillRect(x + sx, y + sy, 2, 2));
  // 月亮
  ctx.fillStyle = '#FFE4B5';
  ctx.beginPath();
  ctx.arc(x + 115, y + 22, 10, 0, Math.PI * 2);
  ctx.fill();
  // 城市剪影
  ctx.fillStyle = '#151530';
  const buildings = [[0,65,20,25],[24,58,16,32],[44,62,22,28],[70,55,18,35],[96,60,20,30],[120,65,16,25]];
  buildings.forEach(([bx, by, bw, bh]) => {
    ctx.fillRect(x + bx, y + by, bw, bh);
    // 窗户灯
    ctx.fillStyle = '#FFE4B5';
    for (let wy = y + by + 5; wy < y + by + bh - 5; wy += 10) {
      for (let wx = x + bx + 4; wx < x + bx + bw - 4; wx += 8) {
        if (Math.random() > 0.45) ctx.fillRect(wx, wy, 2, 3);
      }
    }
    ctx.fillStyle = '#151530';
  });
  // 窗框
  ctx.fillStyle = '#3d3d5c';
  ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
  ctx.fillRect(x, y + h / 2 - 1.5, w, 3);
}

function drawMonitor(ctx, x, y, w, h) {
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w / 2 - 3, y + h, 6, 10);
  ctx.fillRect(x + w / 2 - 10, y + h + 8, 20, 4);

  ctx.fillStyle = '#333';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(x, y, w, h);

  // 代码行
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 3, y + 5, 18, 2);
  ctx.fillRect(x + 3, y + 10, 30, 2);
  ctx.fillRect(x + 3, y + 15, 12, 2);
  ctx.fillRect(x + 3, y + 20, 25, 2);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 3, y + 10, 6, 2);
}

function drawWideMonitor(ctx, x, y, w, h) {
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w / 2 - 4, y + h, 8, 10);
  ctx.fillRect(x + w / 2 - 15, y + h + 8, 30, 4);

  ctx.fillStyle = '#333';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#f8f8f0';
  ctx.fillRect(x, y, w, h);

  // PPT 标题栏
  ctx.fillStyle = '#2d5a27';
  ctx.fillRect(x, y, w, 7);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 4, y + 2, 50, 3);

  // 图表
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 10, y + 16, 14, 16);
  ctx.fillRect(x + 36, y + 12, 14, 20);
  ctx.fillRect(x + 62, y + 16, 14, 16);
  ctx.fillRect(x + 88, y + 10, 14, 22);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 23, y + 16, 14, 18);

  ctx.fillStyle = '#ccc';
  ctx.fillRect(x + 8, y + 32, 105, 1);
}

function drawKeyboard(ctx, x, y, w, h) {
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#333';
  for (let kx = x + 2; kx < x + w - 2; kx += 4) {
    ctx.fillRect(kx, y + 2, 3, 3);
    ctx.fillRect(kx, y + 7, 3, 3);
  }
}

function drawCoffeeCup(ctx, x, y) {
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x, y, 10, 12);
  ctx.fillStyle = '#6B3A2A';
  ctx.fillRect(x + 1, y + 1, 8, 5);
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 10, y + 3, 3, 2);
  ctx.fillRect(x + 11, y + 3, 2, 5);
  ctx.fillRect(x + 10, y + 6, 3, 2);
  // 热气
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x + 3, y - 5, 2, 4);
  ctx.fillRect(x + 6, y - 8, 2, 5);
}

function drawChair(ctx, x, y, w, h) {
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(x - 2, y - 4, w + 4, 8);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 4, y + h, 3, 8);
  ctx.fillRect(x + w - 7, y + h, 3, 8);
}

function drawPlant(ctx, x, y) {
  // 花盆
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x, y + 14, 18, 16);
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x - 2, y + 12, 22, 4);
  // 叶片
  ctx.fillStyle = '#2d8b4a';
  ctx.fillRect(x + 5, y, 8, 14);
  ctx.fillRect(x - 2, y + 4, 8, 6);
  ctx.fillRect(x + 12, y + 4, 8, 6);
  ctx.fillStyle = '#3daa5a';
  ctx.fillRect(x + 6, y + 2, 6, 8);
}

// ═══════════════════════ 角色绘制 ═══════════════════════

function drawCharacter(ctx, grid, x, y, charState) {
  ctx.save();
  if (!charState.facingRight) {
    const charW = grid[0].length * CELL_SIZE;
    ctx.translate(x + charW, y);
    ctx.scale(-1, 1);
    x = 0; y = 0;
  }
  let offsetX = 0, offsetY = 0;
  const phase = charState.bobPhase;
  if (charState.isMoving) {
    offsetY = Math.sin(phase * 4) * 3;
  } else if (charState.status === 'idle') {
    offsetY = Math.sin(phase) * 2;
  } else if (charState.status === 'working') {
    offsetY = Math.sin(phase) * 2;
  } else if (charState.status === 'talking') {
    offsetY = Math.sin(phase * 1.5) * 1;
  } else if (charState.status === 'error') {
    offsetX = Math.sin(phase * 2) * 2;
  }
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const val = grid[row][col];
      if (val === 0) continue;
      ctx.fillStyle = COLOR_MAP[val];
      ctx.fillRect(x + offsetX + col * CELL_SIZE, y + offsetY + row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
  ctx.restore();
}

// ═══════════════════════ 工作状态元素 ═══════════════════════

function drawLaptopOnDesk(ctx, homeKey) {
  const pos = LAPTOP_POSITIONS[homeKey] || LAPTOP_POSITIONS.xm_desk;
  // 工作状态笔记本有呼吸发光
  if (!laptopAnimTimers[homeKey]) laptopAnimTimers[homeKey] = 0;
  laptopAnimTimers[homeKey] += 0.016;
  const glowAlpha = 0.08 + Math.sin(laptopAnimTimers[homeKey] * 3) * 0.04;
  drawLaptop(ctx, pos.x, pos.y, glowAlpha);
}

function drawLaptop(ctx, x, y, glowAlpha = 0.08) {
  // ── 屏幕发光 ──
  ctx.fillStyle = `rgba(74, 144, 217, ${glowAlpha})`;
  ctx.fillRect(x - 8, y - 4, 40, 30);

  // ── 机身 ──
  ctx.fillStyle = '#2a2a4a';
  ctx.fillRect(x, y, 24, 16);
  ctx.strokeStyle = '#4a4a6a';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x, y, 24, 16);

  // ── 屏幕内容 ──
  ctx.fillStyle = '#1a2a4a';
  ctx.fillRect(x + 2, y + 1, 20, 12);
  // 代码/终端行
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 4, y + 3, 12, 1.5);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 4, y + 6, 8, 1.5);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 4, y + 9, 14, 1.5);
  // 光标闪烁
  const blink = Math.floor(Date.now() / 500) % 2;
  if (blink) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x + 15, y + 9, 3, 1.5);
  }

  // ── 键盘底座 ──
  ctx.fillStyle = '#444';
  ctx.fillRect(x - 2, y + 16, 28, 5);
  ctx.fillStyle = '#555';
  for (let kx = 0; kx < 7; kx++) {
    ctx.fillRect(x + kx * 3.5, y + 17, 2.5, 2);
  }
}

// ═══════════════════════ 气泡绘制（优化版） ═══════════════════════

const BUBBLE_ICONS = {
  working: '\u2699',
  talking: '\uD83D\uDCAC',
  error:    '\uD83D\uDC1B',
  idle:     '\uD83D\uDCA4',
};

const BUBBLE_COLORS = {
  working: { bg: '#1a2a3a', border: '#4A90D9', glow: 'rgba(74,144,217,0.3)' },
  talking: { bg: '#1a3a1a', border: '#67C23A', glow: 'rgba(103,194,58,0.3)' },
  error:   { bg: '#3a1a1a', border: '#F56C6C', glow: 'rgba(245,108,108,0.4)' },
  idle:    { bg: '#2a2a2a', border: '#909399', glow: 'rgba(144,147,153,0.15)' },
};

function drawBubble(ctx, agent, x, y) {
  if (!agent.activity && agent.status !== 'offline') return;
  const text = agent.status === 'offline' ? '离线' : agent.activity;
  if (!text) return;

  const icon = BUBBLE_ICONS[agent.status] || BUBBLE_ICONS.idle;
  const colors = BUBBLE_COLORS[agent.status] || BUBBLE_COLORS.idle;

  // 打字机效果：根据 agent 的 progress 截断文字
  const typingProgress = agent.progress || 0;
  const displayText = agent.status === 'working'
    ? `${icon} ${text.substring(0, Math.ceil(text.length * typingProgress / 100))}`
    : `${icon} ${text}`;

  ctx.font = '11px "Press Start 2P"';  // ↑ 从 8px 增大到 11px
  const textWidth = ctx.measureText(displayText).width;
  const bubbleW = Math.max(textWidth + 24, 80);
  const bubbleH = 28;  // ↑ 从 22 增大到 28
  const bx = x - bubbleW / 2 + 45;
  const by = y;

  // ── 外发光效果 ──
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 6;

  // ── 气泡主体 ──
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(bx, by, bubbleW, bubbleH, 6); ctx.fill(); ctx.stroke();

  ctx.shadowBlur = 0;

  // ── 小三角指示器 ──
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.moveTo(bx + bubbleW / 2 - 6, by + bubbleH);
  ctx.lineTo(bx + bubbleW / 2, by + bubbleH + 8);
  ctx.lineTo(bx + bubbleW / 2 + 6, by + bubbleH);
  ctx.fill();

  // ── 文字 ──
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(displayText, bx + 12, by + 18);

  // ── 环形进度条（工作状态专用）──
  if (agent.status === 'working' && agent.progress > 0) {
    drawCircularProgress(ctx, bx + bubbleW + 4, by + bubbleH / 2, 8, agent.progress / 100, colors.border);
  }
}

// ═══════════════════════ 环形进度指示器 ═══════════════════════
function drawCircularProgress(ctx, cx, cy, radius, percent, color) {
  // 背景圈
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 进度弧
  if (percent > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * percent);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // 百分比数字
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(percent * 100) + '%', cx, cy + 3);
  ctx.textAlign = 'start';
}
