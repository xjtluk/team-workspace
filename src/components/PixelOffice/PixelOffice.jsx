import { useRef, useEffect } from 'preact/hooks';
import { CCLAWD_GRID, MARVIS_GRID, CX_GRID, HERMES_GRID, COLOR_MAP, GRID_REGISTRY } from '../../grids/CharacterGrids.js';
import './PixelOffice.css';

const CELL_SIZE = 5;
const CANVAS_W = 1000;
const CANVAS_H = 700;
const MAX_DT = 0.05;

// ═══════════════════════ 16-bit 像素风统一色值表 ═══════════════════════
const PALETTE = {
  floorLight:   '#4e6048',
  floorDark:    '#3e5038',
  aisle:        '#627259',
  wall:         '#7c644a',
  wallDark:     '#5a3e2e',
  wallPanel:    '#6b5538',
  deskSide:     '#9c7a4b',
  deskTop:      '#dbb46a',
  monitorFrame: '#2a2a2a',
  screenCode:   '#aaffaa',
  dashboardBg:  '#1a262e',
  dashboardBdr: '#44ccff',
  bossWall:     '#5a3e2e',
  bossFloor:    '#3a2a1a',
  carpet:       '#4a5568',
  serverRack:   '#2d3748',
  meetingTable: '#8B7355',
  arcadeBody:   '#2d1f4a',
  // 新增：区域分隔墙（高对比，10px 厚）
  divWall:      '#c4956a',
  divWallDark:  '#8b5a3a',
  divWallLight: '#dab88a',
  doorFrame:    '#6b4a3a',
  doorOpen:     '#1a1008',
  floorEdge:    '#586d50',
};

// ── 角色主题色 ──
const AGENT_THEMES = {
  cx:     '#ffaa66',
  cc:     '#99ccff',
  xiaoma: '#88dd88',
  hermes: '#cc99ff',
  empty:  '#aaaaaa',
};

// ═══════════════════════ 缓动函数库 ═══════════════════════
const EASING = {
  easeInOutQuad: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOutCubic:  t => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack:   t => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  linear:        t => t,
};

// ═══════════════════════ 6区布局 ═══════════════════════
// ┌──────────────────────────────────────────────────────────────┐
// │ 左上 Dashboard    │  中部工位区(3列×2行)  │ 右上 Boss Office │
// │ 30~250, 130~260  │  270~730, 40~430     │ 750~970, 50~190  │
// ├──────────────────┤                      ├──────────────────┤
// │ 左下 Server Room │  中下 Meeting Area   │ 右下 Entertainment│
// │ 30~150, 450~660  │  380~720, 450~660    │ 730~970, 450~660 │
// └──────────────────────────────────────────────────────────────┘

// ── 6个工位（3列×2行）──
// 工位区：x 275~715, y 115~415 （分隔墙 258 右侧 ~ 738 左侧）
const DESK_CONFIGS = [
  { id: 'cx',     name: 'CX',   role: '代码工程师', theme: '#ffaa66', gridCol: 0, gridRow: 0 },
  { id: 'cc',     name: 'CC',   role: '软件架构师', theme: '#99ccff', gridCol: 1, gridRow: 0 },
  { id: 'xiaoma', name: '小马',  role: '项目经理',   theme: '#88dd88', gridCol: 2, gridRow: 0 },
  { id: 'hermes', name: 'Hermes', role: '技术主管',  theme: '#cc99ff', gridCol: 0, gridRow: 1 },
  { id: 'emptyA', name: '空位A', role: '待招聘',     theme: '#aaaaaa', gridCol: 1, gridRow: 1 },
  { id: 'emptyB', name: '空位B', role: '待招聘',     theme: '#aaaaaa', gridCol: 2, gridRow: 1 },
];

const GRID_START_X = 300;
const GRID_START_Y = 125;
const COL_SPACING = 145;
const ROW_SPACING = 200;

function getDeskPos(cfg) {
  return {
    deskX: GRID_START_X + cfg.gridCol * COL_SPACING,
    deskY: GRID_START_Y + cfg.gridRow * ROW_SPACING,
    deskW: 130,
    deskH: 65,
  };
}

// 角色站在桌子前方
function getCharPos(cfg) {
  const { deskX, deskY, deskW, deskH } = getDeskPos(cfg);
  return {
    x: deskX + deskW / 2,
    y: deskY + deskH + 65,
  };
}

// 构建位置查找表
const DESK_POSITIONS = {};
const CHAR_POSITIONS = {};
const DESK_HITBOXES = []; // 碰撞检测

DESK_CONFIGS.forEach(cfg => {
  const desk = getDeskPos(cfg);
  const char = getCharPos(cfg);
  DESK_POSITIONS[cfg.id] = desk;
  CHAR_POSITIONS[cfg.id] = char;
  DESK_HITBOXES.push({
    id: cfg.id,
    name: cfg.name,
    role: cfg.role,
    x: desk.deskX - 10,
    y: desk.deskY - 10,
    w: desk.deskW + 20,
    h: desk.deskH + 100,
  });
});

// 角色默认"家"
const HOME_LOCATIONS = {
  cc:     { x: CHAR_POSITIONS.cc.x, y: CHAR_POSITIONS.cc.y },
  cx:     { x: CHAR_POSITIONS.cx.x, y: CHAR_POSITIONS.cx.y },
  xiaoma: { x: CHAR_POSITIONS.xiaoma.x, y: CHAR_POSITIONS.xiaoma.y },
  hermes: { x: CHAR_POSITIONS.hermes.x, y: CHAR_POSITIONS.hermes.y },
};

// 笔记本位置（桌面上）
const LAPTOP_POSITIONS = {};
DESK_CONFIGS.forEach(cfg => {
  const desk = DESK_POSITIONS[cfg.id];
  if (!desk) return;
  LAPTOP_POSITIONS[cfg.id] = { x: desk.deskX + desk.deskW / 2 - 14, y: desk.deskY - 30 };
});

const laptopAnimTimers = {};

// ═══════════════════════ 角色状态机 ═══════════════════════
const CHAR_STATES = {
  idle:     { speed: 0 },
  working:  { speed: 0 },
  talking:  { speed: 0 },
  walking:  { speed: 120 },
  error:    { speed: 0 },
  offline:  { speed: 0 },
};

const charAnimState = {};

// 空闲散步点
const WANDER_POINTS = [
  { x: 420, y: 400 },
  { x: 560, y: 410 },
  { x: 480, y: 430 },
  { x: 350, y: 420 },
  { x: 620, y: 395 },
];

function getCharState(agentId) {
  if (!charAnimState[agentId]) {
    const home = HOME_LOCATIONS[agentId] || CHAR_POSITIONS.emptyB;
    charAnimState[agentId] = {
      x: home.x, y: home.y,
      moveStartX: home.x, moveStartY: home.y,
      moveTargetX: home.x, moveTargetY: home.y,
      moveProgress: 1, moveDuration: 1,
      prevStatus: 'offline', status: 'offline',
      isMoving: false, facingRight: agentId === 'cc' ? false : true,
      bobPhase: 0, stateBlend: 1,
      blinkTimer: 0, blinkState: 0,
    };
  }
  return charAnimState[agentId];
}

function updateCharState(agentId, agent, dt, allAgents) {
  const cs = getCharState(agentId);
  const rawHome = HOME_LOCATIONS[agentId];
  const home = rawHome || CHAR_POSITIONS.emptyB;
  if (!home) return;
  const speed = CHAR_STATES.walking.speed;

  // 眨眼计时器
  cs.blinkTimer += dt * 30;
  if (cs.blinkTimer > 90 + Math.random() * 30) {
    cs.blinkTimer = 0;
    cs.blinkState = 3; // 闭眼3帧
  }
  if (cs.blinkState > 0) cs.blinkState -= dt * 30;

  // 状态过渡
  if (cs.status !== agent.status) {
    cs.prevStatus = cs.status;
    cs.status = agent.status;
    cs.stateBlend = 0;
  }
  if (cs.stateBlend < 1) cs.stateBlend = Math.min(1, cs.stateBlend + dt * 4);

  // 工作状态 — 走向工位
  if (agent.status === 'working') {
    const distToDesk = Math.sqrt((cs.x - home.x) ** 2 + (cs.y - home.y) ** 2);
    if (distToDesk > 5) {
      startTweenMove(cs, home.x, home.y, speed);
    } else {
      cs.isMoving = false; cs.moveProgress = 1;
      cs.x = home.x; cs.y = home.y;
    }
    cs.bobPhase += dt * 8;
    return;
  }

  // 空闲/离线 — 散步
  if (agent.status === 'idle' || agent.status === 'offline') {
    if (cs.prevStatus === 'working') { cs._idleTimer = 0; cs._returnTimer = 0; }
    if (!cs._idleTimer) cs._idleTimer = 0;
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
      cs.isMoving = false; cs.moveProgress = 1;
      if (cs._idleTimer > (2 + Math.random() * 3)) {
        cs._idleTimer = 0;
        const candidates = WANDER_POINTS.filter(p =>
          Math.sqrt((p.x - home.x) ** 2 + (p.y - home.y) ** 2) > 120
        );
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || WANDER_POINTS[0];
        startTweenMove(cs,
          pick.x + (Math.random() - 0.5) * 60,
          pick.y + (Math.random() - 0.5) * 30,
          speed * 0.6
        );
      }
    } else {
      cs.isMoving = true;
    }
  }

  applyTweenMove(cs, dt);

  cs.bobPhase += dt * (
    cs.status === 'working'  ? 8 :
    cs.status === 'talking'  ? 10 :
    cs.status === 'error'    ? 15 : 2
  );
}

// ═══════════════════════ Tween 移动系统 ═══════════════════════
function startTweenMove(cs, tx, ty, speed) {
  const dx = tx - cs.x, dy = ty - cs.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  cs.moveStartX = cs.x; cs.moveStartY = cs.y;
  cs.moveTargetX = tx; cs.moveTargetY = ty;
  cs.moveProgress = 0;
  cs.moveDuration = Math.max(0.3, dist / speed);
  cs.isMoving = true;
  cs.facingRight = dx > 0;
}

function applyTweenMove(cs, dt) {
  if (!cs.isMoving) return;
  cs.moveProgress += dt / cs.moveDuration;
  if (cs.moveProgress >= 1) {
    cs.x = cs.moveTargetX; cs.y = cs.moveTargetY;
    cs.isMoving = false; cs.moveProgress = 1;
  } else {
    const t = EASING.easeInOutQuad(cs.moveProgress);
    cs.x = cs.moveStartX + (cs.moveTargetX - cs.moveStartX) * t;
    cs.y = cs.moveStartY + (cs.moveTargetY - cs.moveStartY) * t;
  }
}

// ═══════════════════════ 主组件 ═══════════════════════
export function PixelOffice({ agents, onHoverDesk }) {
  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const agentsRef = useRef(agents);
  const lastTimeRef = useRef(0);
  const bgCanvasRef = useRef(null);
  const hoverRef = useRef(null);
  const onHoverDeskRef = useRef(onHoverDesk);
  agentsRef.current = agents;
  onHoverDeskRef.current = onHoverDesk;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // 预渲染静态背景
    if (!bgCanvasRef.current) {
      const bg = document.createElement('canvas');
      bg.width = CANVAS_W;
      bg.height = CANVAS_H;
      const bgCtx = bg.getContext('2d');
      bgCtx.imageSmoothingEnabled = false;
      drawFullBackground(bgCtx);
      bgCanvasRef.current = bg;
    }

    // ── 鼠标移动检测 ──
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      let found = null;
      for (const hb of DESK_HITBOXES) {
        if (mx >= hb.x && mx <= hb.x + hb.w && my >= hb.y && my <= hb.y + hb.h) {
          found = hb;
          break;
        }
      }

      if (found !== hoverRef.current) {
        hoverRef.current = found;
        if (onHoverDeskRef.current) {
          onHoverDeskRef.current(found ? {
            id: found.id,
            name: found.name,
            role: found.role,
            x: e.clientX, y: e.clientY,
          } : null);
        }
      }
    };

    const handleMouseLeave = () => {
      hoverRef.current = null;
      if (onHoverDeskRef.current) onHoverDeskRef.current(null);
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // ── 游戏循环 ──
    const gameLoop = (timestamp) => {
      let dt = lastTimeRef.current ? (timestamp - lastTimeRef.current) / 1000 : 0.016;
      dt = Math.min(dt, MAX_DT);
      lastTimeRef.current = timestamp;

      const currentAgents = agentsRef.current;

      // 绘制预渲染背景
      ctx.drawImage(bgCanvasRef.current, 0, 0);

      // 绘制动画元素（含黑板角色状态卡）
      drawAnimationLayer(ctx, dt, currentAgents);

      // 绘制角色
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
          const dk = DESK_CONFIGS.find(d => d.id === agent.id);
          if (dk) drawLaptopOnDesk(ctx, dk.id);
        }

        drawBubble(ctx, agent, cs.x, cs.y - 70);
        ctx.globalAlpha = 1;
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };
    gameLoop(0);

    return () => {
      cancelAnimationFrame(gameLoopRef.current);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} class="pixel-canvas" />;
}

// ═══════════════════════════════════════════════════════════
//  完整背景绘制
// ═══════════════════════════════════════════════════════════

function drawFullBackground(ctx) {
  // ── 底色 ──
  ctx.fillStyle = '#2a3a2a';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // ── 地板瓷砖（全区域）──
  for (let x = 0; x < CANVAS_W; x += 20) {
    for (let y = 110; y < CANVAS_H; y += 20) {
      ctx.fillStyle = ((Math.floor(x / 20) + Math.floor(y / 20)) % 2 === 0)
        ? PALETTE.floorLight : PALETTE.floorDark;
      ctx.fillRect(x, y, 20, 20);
    }
  }

  // ══════════════════════════════════════
  //  区域分隔墙系统（10px 厚，高对比色）
  // ══════════════════════════════════════

  // ── 上方墙壁带（天花板+墙壁区域）──
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(0, 0, CANVAS_W, 108);
  ctx.fillStyle = PALETTE.wallDark;
  ctx.fillRect(0, 104, CANVAS_W, 4);

  // ── 天花板灯条 ──
  drawCeilingLights(ctx);

  // ═══════════════ 墙体系列（10px厚，三层立体感） ═══════════════

  // ── 垂直墙1：Dashboard 区 ↔ 工位区（x=258）──
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(258, 108, 10, 340);
  ctx.fillStyle = PALETTE.divWall;
  ctx.fillRect(260, 108, 6, 340);
  ctx.fillStyle = PALETTE.divWallLight;
  ctx.fillRect(261, 108, 4, 340);
  // 墙头横梁
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(255, 108, 16, 6);
  // 门洞（Dashboard ↔ 工位区）
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(260, 290, 6, 60);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(256, 288, 14, 5);
  ctx.fillRect(256, 347, 14, 5);

  // ── 垂直墙2：工位区 ↔ Boss Office（x=738）──
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(738, 108, 10, 340);
  ctx.fillStyle = PALETTE.divWall;
  ctx.fillRect(740, 108, 6, 340);
  ctx.fillStyle = PALETTE.divWallLight;
  ctx.fillRect(741, 108, 4, 340);
  // 墙头横梁
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(735, 108, 16, 6);
  // 门洞（工位区 ↔ Boss Office）
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(740, 180, 6, 65);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(736, 178, 14, 5);
  ctx.fillRect(736, 242, 14, 5);

  // ── 水平墙：上方区域 ↔ 下方区域（y=448）──
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(0, 448, CANVAS_W, 10);
  ctx.fillStyle = PALETTE.divWall;
  ctx.fillRect(0, 450, CANVAS_W, 6);
  ctx.fillStyle = PALETTE.divWallLight;
  ctx.fillRect(0, 451, CANVAS_W, 4);
  // 墙头横梁
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(0, 445, CANVAS_W, 5);
  // 门洞左（Server Room ↔ 过道）：x=170-220
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(170, 450, 50, 6);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(167, 446, 56, 5);
  ctx.fillRect(167, 454, 56, 5);
  // 门洞中（过道 ↔ Meeting Area）：x=460-510
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(460, 450, 50, 6);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(457, 446, 56, 5);
  ctx.fillRect(457, 454, 56, 5);
  // 门洞右（过道 ↔ Lounge）：x=710-760
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(710, 450, 50, 6);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(707, 446, 56, 5);
  ctx.fillRect(707, 454, 56, 5);

  // ── 垂直墙3（下层）：Server Room ↔ Meeting（x=368）──
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(368, 448, 10, 230);
  ctx.fillStyle = PALETTE.divWall;
  ctx.fillRect(370, 448, 6, 230);
  ctx.fillStyle = PALETTE.divWallLight;
  ctx.fillRect(371, 448, 4, 230);
  // 门洞
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(370, 558, 6, 44);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(366, 556, 14, 5);
  ctx.fillRect(366, 599, 14, 5);

  // ── 垂直墙4（下层）：Meeting ↔ Lounge（x=718）──
  ctx.fillStyle = PALETTE.divWallDark;
  ctx.fillRect(718, 448, 10, 230);
  ctx.fillStyle = PALETTE.divWall;
  ctx.fillRect(720, 448, 6, 230);
  ctx.fillStyle = PALETTE.divWallLight;
  ctx.fillRect(721, 448, 4, 230);
  // 门洞
  ctx.fillStyle = PALETTE.doorOpen;
  ctx.fillRect(720, 558, 6, 44);
  ctx.fillStyle = PALETTE.doorFrame;
  ctx.fillRect(716, 556, 14, 5);
  ctx.fillRect(716, 599, 14, 5);

  // ── 过道地面（墙体之间的通道）──
  ctx.fillStyle = PALETTE.aisle;
  ctx.fillRect(10, 441, 360, 14);
  ctx.fillRect(378, 441, 340, 14);
  ctx.fillRect(728, 441, 262, 14);

  // ── 过道边缘阴影 ──
  ctx.fillStyle = PALETTE.floorEdge;
  ctx.fillRect(10, 455, 360, 3);
  ctx.fillRect(378, 455, 340, 3);
  ctx.fillRect(728, 455, 262, 3);

  // ══════════════════════════════════════
  //  绘制各区域内容
  // ══════════════════════════════════════

  // ═══════════ 左上：Dashboard（放大2×，贴左上角 x=10~260, y=4~444）══════════
  drawDashboard(ctx, 10, 4, 248, 440);

  // ═══════════ 中部：6工位 3×2 ═══════════
  DESK_CONFIGS.forEach(cfg => {
    const d = DESK_POSITIONS[cfg.id];
    if (!d) return;
    const isOccupied = ['cx', 'cc', 'xiaoma', 'hermes'].includes(cfg.id);
    const occupiedBy = isOccupied ? cfg.id : null;
    drawWorkstation(ctx, d.deskX, d.deskY, d.deskW, d.deskH, cfg, occupiedBy);
  });

  // ═══════════ 右上：Boss Office ═══════════
  drawBossOffice(ctx, 752, 114, 236, 325);

  // ═══════════ 左下：Server Room ═══════════
  drawServerRoom(ctx, 10, 464, 350, 215);

  // ═══════════ 中下：Meeting Area ═══════════
  drawMeetingArea(ctx, 386, 464, 324, 215);

  // ═══════════ 右下：Entertainment ═══════════
  drawEntertainment(ctx, 728, 464, 260, 215);

  // ── 过道装饰 ──
  drawPlant(ctx, 180, 432);
  drawPlant(ctx, 520, 432);
  drawPlant(ctx, 640, 432);

  // ── 饮水机（过道旁）──
  drawWaterDispenser(ctx, 210, 460);
}

// ═══════════════════════ 动画元素层 ═══════════════════════
const animTimers = {
  screenScroll: 0,
  serverBlink: 0,
  arcadeLight: 0,
  clockMinute: 0,
  clockHour: 0,
  coffeeSteam: 0,
  waterBubble: 0,
  treadmillBelt: 0,
  dashboardPulse: 0,
};

function drawAnimationLayer(ctx, dt, agents) {
  animTimers.screenScroll += dt * 30;
  animTimers.serverBlink += dt * 15;
  animTimers.arcadeLight += dt * 8;
  animTimers.clockMinute += dt * 40;
  animTimers.clockHour += dt * 240;
  animTimers.coffeeSteam += dt * 30;
  animTimers.waterBubble += dt * 40;
  animTimers.treadmillBelt += dt * 20;
  animTimers.dashboardPulse += dt * 30;

  // 屏幕代码滚动（各工位显示器）
  DESK_CONFIGS.forEach(cfg => {
    const d = DESK_POSITIONS[cfg.id];
    if (!d) return;
    const occupied = ['cx', 'cc', 'xiaoma', 'hermes'].includes(cfg.id);
    if (occupied) {
      drawScreenContent(ctx, d.deskX, d.deskY, d.deskW, cfg.id);
    }
  });

  // 服务器指示灯
  drawServerLights(ctx, animTimers.serverBlink);

  // 街机屏幕
  drawArcadeScreen(ctx, animTimers.arcadeLight);

  // 时钟动画
  drawAnimatedClock(ctx, animTimers.clockMinute, animTimers.clockHour);

  // 咖啡机蒸汽
  drawCoffeeSteam(ctx, animTimers.coffeeSteam);

  // 饮水机气泡
  drawWaterBubbles(ctx, animTimers.waterBubble);

  // 跑步机跑带
  drawTreadmillBelt(ctx, animTimers.treadmillBelt);

  // Dashboard 呼吸灯
  drawDashboardPulse(ctx, animTimers.dashboardPulse);

  // 黑板角色状态卡（2×2）
  if (agents) drawDashboardCards(ctx, agents);
}

// ═══════════════════════ Dashboard：黑板风格 ═══════════════════════
// 248×440 木框黑板，贴左上角 (10, 4)
function drawDashboard(ctx, x, y, w, h) {
  // 木框外壳（深色外框）
  ctx.fillStyle = '#5a3620';
  ctx.beginPath(); ctx.roundRect(x - 4, y - 4, w + 8, h + 8, 10); ctx.fill();
  // 木框中层
  ctx.fillStyle = '#8B6914';
  ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 8); ctx.fill();
  // 木框内层
  ctx.fillStyle = '#A0782C';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
  // 框内侧阴影
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(x + 4, y + 4, w - 8, 2);
  ctx.fillRect(x + 4, y + 4, 2, h - 8);
  ctx.fillRect(x + w - 6, y + 4, 2, h - 8);
  ctx.fillRect(x + 4, y + h - 6, w - 8, 2);

  // 黑板面（深墨绿色）
  const boardX = x + 12, boardY = y + 12, boardW = w - 24, boardH = h - 24;
  ctx.fillStyle = '#1e3a1e';
  ctx.fillRect(boardX, boardY, boardW, boardH);
  // 黑板纹理（轻微噪点）
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let bx = boardX; bx < boardX + boardW; bx += 8) {
    for (let by = boardY; by < boardY + boardH; by += 8) {
      if (Math.random() > 0.5) ctx.fillRect(bx, by, 6, 6);
    }
  }

  // 粉笔槽（底部木条）
  ctx.fillStyle = '#6B4914';
  ctx.fillRect(x + 8, y + h - 18, w - 16, 12);
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x + 8, y + h - 18, w - 16, 3);
  // 粉笔
  ctx.fillStyle = '#fffef0';
  ctx.fillRect(x + 20, y + h - 14, 14, 4);
  ctx.fillRect(x + 38, y + h - 14, 10, 4);
  ctx.fillStyle = '#ffdd88';
  ctx.fillRect(x + 54, y + h - 14, 12, 4);
  ctx.fillStyle = '#ff8a80';
  ctx.fillRect(x + 72, y + h - 14, 8, 4);
  // 黑板擦
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x + w - 50, y + h - 16, 30, 8);
  ctx.fillStyle = '#ccc';
  ctx.fillRect(x + w - 48, y + h - 15, 26, 6);

  // === 粉笔标题 ===
  ctx.font = '12px "Press Start 2P"';
  ctx.fillStyle = '#f8f8e8';
  ctx.textAlign = 'center';
  ctx.fillText('团队看板', x + w / 2, boardY + 28);

  // 标题下划线
  ctx.fillStyle = '#f8f8e8';
  ctx.fillRect(x + w / 2 - 55, boardY + 34, 110, 2);

  // 副标题
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = 'rgba(255,255,240,0.6)';
  ctx.fillText('状态报告', x + w / 2, boardY + 50);

  // === 4个角色卡片占位（2×2）===
  // 卡片由 drawDashboardCards() 动态绘制
  // 这里画占位虚线框
  const cardW = 90, cardH = 120;
  const startCX = boardX + 14, startCY = boardY + 60;
  const gapX = 10, gapY = 14;

  [
    { col: 0, row: 0 },  // CX (左上)
    { col: 1, row: 0 },  // CC (右上)
    { col: 0, row: 1 },  // 小马 (左下)
    { col: 1, row: 1 },  // Hermes (右下)
  ].forEach(({ col, row }) => {
    const cx = startCX + col * (cardW + gapX);
    const cy = startCY + row * (cardH + gapY);
    // 虚线框
    ctx.strokeStyle = 'rgba(255,255,240,0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(cx, cy, cardW, cardH);
    ctx.setLineDash([]);
  });

  // 粉笔日期
  ctx.font = '6px "Press Start 2P"';
  ctx.fillStyle = 'rgba(255,255,240,0.4)';
  ctx.textAlign = 'end';
  const d = new Date();
  ctx.fillText(
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
    x + w - 20, boardY + 46
  );
  ctx.textAlign = 'start';
}

// 黑板呼吸动画（轻微微光）
function drawDashboardPulse(ctx, phase) {
  const alpha = 0.03 + Math.sin(phase * 0.5) * 0.02;
  ctx.fillStyle = `rgba(255,255,200,${alpha})`;
  ctx.fillRect(22, 16, 220, 416);
}

// ═══════════════════════ 动态角色状态卡 ═══════════════════════
function drawDashboardCards(ctx, agents) {
  const boardX = 22, boardY = 16;
  const cardW = 90, cardH = 120;
  const startCX = boardX + 14, startCY = boardY + 60;
  const gapX = 10, gapY = 14;

  const cardOrder = ['cx', 'cc', 'xiaoma', 'hermes'];

  cardOrder.forEach((agentId, idx) => {
    const col = idx % 2, row = Math.floor(idx / 2);
    const cx = startCX + col * (cardW + gapX);
    const cy = startCY + row * (cardH + gapY);

    const agent = agents[agentId];
    const theme = AGENT_THEMES[agentId] || '#aaa';
    const status = agent ? agent.status : 'offline';
    const statusText = {
      working: '工作中', idle: '空闲中', talking: '讨论中',
      error: '异常', offline: '离线',
    }[status] || status.toUpperCase();
    const statusColor = {
      working: '#44ff44', idle: '#FFD700', talking: '#44aaff',
      error: '#ff4444', offline: '#888',
    }[status] || '#888';

    // 卡片底板
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(cx - 1, cy - 1, cardW + 2, cardH + 2);
    ctx.fillStyle = 'rgba(25,25,25,0.7)';
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeStyle = theme;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, cy, cardW, cardH);

    // 像素头像（小）
    const grid = GRID_REGISTRY[agentId];
    if (grid) {
      const avatarSize = 3; // 缩小像素头像
      const avatarCX = cx + cardW / 2;
      const avatarCY = cy + 30;
      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
          const val = grid[r][c];
          if (val === 0) continue;
          ctx.fillStyle = COLOR_MAP[val] || COLOR_MAP[1];
          ctx.fillRect(
            avatarCX - (grid[0].length * avatarSize) / 2 + c * avatarSize,
            avatarCY - 18 + r * avatarSize,
            avatarSize, avatarSize
          );
        }
      }
    }

    // 姓名
    const nameMap = { cx: 'CX', cc: 'CC', xiaoma: '\u5C0F\u9A6C', hermes: 'Hermes' };
    ctx.font = '8px "Press Start 2P"';
    ctx.fillStyle = '#f8f8e8';
    ctx.textAlign = 'center';
    ctx.fillText(nameMap[agentId] || agentId, cx + cardW / 2, cy + 54);

    // 角色
    const roleMap = { cx: '\u4EE3\u7801\u5DE5\u7A0B\u5E08', cc: '\u8F6F\u4EF6\u67B6\u6784\u5E08', xiaoma: '\u9879\u76EE\u7ECF\u7406', hermes: '\u6280\u672F\u4E3B\u7BA1' };
    ctx.font = '5px "Press Start 2P"';
    ctx.fillStyle = 'rgba(255,255,240,0.5)';
    ctx.fillText(roleMap[agentId] || '', cx + cardW / 2, cy + 66);

    // 状态指示灯
    ctx.fillStyle = statusColor;
    ctx.beginPath();
    ctx.arc(cx + 14, cy + 82, 5, 0, Math.PI * 2);
    ctx.fill();
    // 光晕
    ctx.fillStyle = statusColor.replace(')', ',0.4)').replace('rgb', 'rgba');
    if (statusColor.startsWith('#')) {
      ctx.fillStyle = statusColor + '66';
    }
    ctx.beginPath();
    ctx.arc(cx + 14, cy + 82, 8, 0, Math.PI * 2);
    ctx.fill();

    // 状态文本
    ctx.font = '6px "Press Start 2P"';
    ctx.fillStyle = statusColor;
    ctx.textAlign = 'start';
    ctx.fillText(statusText, cx + 24, cy + 85);

    // activity 概况（12字截断）
    if (agent && agent.activity) {
      const summary = agent.activity.length > 12 ? agent.activity.substring(0, 12) + '..' : agent.activity;
      ctx.font = '4px "Press Start 2P"';
      ctx.fillStyle = 'rgba(255,255,240,0.35)';
      ctx.textAlign = 'center';
      ctx.fillText(summary, cx + cardW / 2, cy + 94);
      ctx.textAlign = 'start';
    }

    // 进度条（工作中）
    if (status === 'working' && agent && agent.progress > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(cx + 6, cy + 96, cardW - 12, 6);
      ctx.fillStyle = statusColor;
      ctx.fillRect(cx + 6, cy + 96, (cardW - 12) * agent.progress / 100, 6);
      ctx.font = '5px "Press Start 2P"';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(agent.progress) + '%', cx + cardW / 2, cy + 114);
    } else if (status === 'offline') {
      ctx.font = '5px "Press Start 2P"';
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.fillText('(离线)', cx + cardW / 2, cy + 106);
    }

    ctx.textAlign = 'start';
  });
}

// ═══════════════════════ 工位 ═══════════════════════
function drawWorkstation(ctx, x, y, w, h, cfg, occupiedBy) {
  const theme = AGENT_THEMES[cfg.id] || cfg.theme || '#aaaaaa';

  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 4, y + h, w + 8, 8);

  // 桌侧
  ctx.fillStyle = PALETTE.deskSide;
  ctx.fillRect(x, y, w, h);
  // 桌面
  ctx.fillStyle = PALETTE.deskTop;
  ctx.fillRect(x, y, w, 8);

  // 桌腿
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 8, y + h, 5, 18);
  ctx.fillRect(x + w - 13, y + h, 5, 18);

  // 显示器
  drawMonitor(ctx, x + w / 2 - 30, y - 42, 60, 42);

  // 键盘
  drawKeyboard(ctx, x + w / 2 - 35, y + 14, 70, 14);

  // 椅子
  drawChair(ctx, x + w / 2 - 16, y + h + 4, 32, 30);

  // ── 角色专属物品 ──
  if (occupiedBy === 'cc') {
    // CC: 双屏 + 咖啡杯 + 便签
    drawMonitor(ctx, x + 12, y - 42, 40, 32);
    drawMonitor(ctx, x + w - 52, y - 42, 40, 32);
    drawCoffeeCup(ctx, x + w - 22, y + 8);
    ctx.fillStyle = '#FFFDE7';
    ctx.fillRect(x + 58, y - 38, 10, 10);
    ctx.fillStyle = '#FFC107';
    ctx.fillRect(x + 60, y - 37, 6, 2);
  } else if (occupiedBy === 'cx') {
    // CX: 额外终端 + 马克杯
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 6, y + 30, 16, 24);
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 8, y + 34, 12, 4);
    ctx.fillRect(x + 8, y + 42, 12, 4);
    ctx.fillStyle = '#67C23A';
    ctx.fillRect(x + 14, y + 35, 2, 2);
    ctx.fillRect(x + 14, y + 43, 2, 2);
    drawCoffeeCup(ctx, x + w - 20, y + 6);
  } else if (occupiedBy === 'xiaoma') {
    // 小马: 宽屏 + 笔记本 + 笔
    ctx.fillStyle = '#2c1810';
    ctx.fillRect(x + 8, y + 10, 18, 14);
    ctx.fillStyle = '#f5f0e9';
    ctx.fillRect(x + 9, y + 11, 16, 12);
    ctx.fillStyle = '#a0d0e0';
    ctx.fillRect(x + 11, y + 14, 12, 1);
    ctx.fillRect(x + 11, y + 17, 8, 1);
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 22, y + 4, 2, 14);
    ctx.fillStyle = '#E84040';
    ctx.fillRect(x + 22, y + 2, 2, 4);
  } else if (occupiedBy === 'hermes') {
    // Hermes: 双终端 + 对讲机
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 8, y + 28, 14, 20);
    ctx.fillStyle = '#444';
    ctx.fillRect(x + 10, y + 32, 10, 4);
    ctx.fillStyle = '#cc99ff';
    ctx.fillRect(x + 12, y + 33, 3, 2);
    ctx.fillStyle = '#222';
    ctx.fillRect(x + w - 20, y + 8, 10, 8);
    ctx.fillStyle = '#cc99ff';
    ctx.fillRect(x + w - 18, y + 10, 6, 4);
  }

  // 标签
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = theme;
  ctx.textAlign = 'center';
  const label = occupiedBy ? cfg.name : 'EMPTY';
  ctx.fillText(label, x + w / 2, y + h + 44);
  ctx.textAlign = 'start';
}

// ═══════════════════════ Boss Office ═══════════════════════
// 位置：x=752, y=114, w=236, h=325
function drawBossOffice(ctx, x, y, w, h) {
  // 室内墙壁
  ctx.fillStyle = PALETTE.bossWall;
  ctx.fillRect(x, y, w, h);
  // 踢脚线
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(x, y + h - 5, w, 5);
  // 顶部墙沿线
  ctx.fillStyle = '#4a2a1a';
  ctx.fillRect(x, y, w, 3);

  // ── 窗户（左侧墙，带风景）──
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 12, y + 28, 52, 48);  // 窗框外
  ctx.fillStyle = '#8B7355';
  ctx.fillRect(x + 14, y + 30, 48, 44);  // 窗框中
  // 窗外天空
  ctx.fillStyle = '#4a7a9a';
  ctx.fillRect(x + 16, y + 32, 44, 22);
  // 云
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + 24, y + 36, 16, 6);
  ctx.fillRect(x + 44, y + 38, 12, 5);
  // 树
  ctx.fillStyle = '#3a6a3a';
  ctx.fillRect(x + 18, y + 44, 14, 14);
  ctx.fillRect(x + 40, y + 40, 10, 18);
  // 窗格十字
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 38, y + 30, 3, 44);
  ctx.fillRect(x + 14, y + 52, 48, 3);

  // ── 墙上标牌 ──
  ctx.fillStyle = '#FFD700';
  ctx.beginPath(); ctx.roundRect(x + 72, y + 28, 90, 22, 3); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '8px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.fillText('CEO', x + 117, y + 44);

  // ── 书柜（右墙）──
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(x + w - 38, y + 14, 30, 130);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x + w - 36, y + 16, 26, 28);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x + w - 36, y + 48, 26, 28);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x + w - 36, y + 80, 26, 28);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(x + w - 36, y + 112, 26, 28);
  // 搁板
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + w - 38, y + 44, 30, 2);
  ctx.fillRect(x + w - 38, y + 76, 30, 2);
  ctx.fillRect(x + w - 38, y + 108, 30, 2);
  // 书
  const bossBooks = [
    { r: 0, cx: 4, ch: 26, c: '#4A90D9' },
    { r: 0, cx: 13, ch: 22, c: '#F56C6C' },
    { r: 0, cx: 21, ch: 24, c: '#67C23A' },
    { r: 1, cx: 4, ch: 28, c: '#8B4513' },
    { r: 1, cx: 13, ch: 24, c: '#9B59B6' },
    { r: 1, cx: 21, ch: 26, c: '#E74C3C' },
    { r: 2, cx: 4, ch: 28, c: '#FFD700' },
    { r: 2, cx: 13, ch: 24, c: '#1ABC9C' },
    { r: 2, cx: 21, ch: 26, c: '#E67E22' },
    { r: 3, cx: 4, ch: 26, c: '#3498DB' },
    { r: 3, cx: 13, ch: 22, c: '#2ECC71' },
  ];
  bossBooks.forEach(b => {
    ctx.fillStyle = b.c;
    ctx.fillRect(x + w - 34 + b.cx, y + 18 + b.r * 32, 7, b.ch);
  });

  // ── 文件柜（右墙下方）──
  ctx.fillStyle = '#555';
  ctx.fillRect(x + w - 38, y + 148, 30, 70);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + w - 36, y + 150, 12, 20);
  ctx.fillRect(x + w - 20, y + 150, 12, 20);
  ctx.fillRect(x + w - 36, y + 174, 12, 20);
  ctx.fillRect(x + w - 20, y + 174, 12, 20);
  ctx.fillRect(x + w - 36, y + 198, 26, 16);
  // 抽屉把手
  ctx.fillStyle = '#999';
  ctx.fillRect(x + w - 29, y + 157, 4, 1);
  ctx.fillRect(x + w - 13, y + 157, 4, 1);
  ctx.fillRect(x + w - 29, y + 181, 4, 1);
  ctx.fillRect(x + w - 13, y + 181, 4, 1);

  // ── 门 ──
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 6, y + h - 70, 42, 70);
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x + 8, y + h - 68, 14, 38);
  ctx.fillRect(x + 24, y + h - 68, 14, 38);
  ctx.fillRect(x + 8, y + h - 26, 30, 26);
  // 门把手
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 36, y + h - 42, 5, 3);
  // 门上方标牌
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 10, y + h - 76, 32, 10);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '5px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.fillText('KK', x + 26, y + h - 69);

  // ── 地毯 ──
  ctx.fillStyle = 'rgba(139,69,19,0.2)';
  ctx.fillRect(x + 58, y + h - 90, 140, 80);
  ctx.fillStyle = 'rgba(139,69,19,0.1)';
  ctx.fillRect(x + 60, y + h - 88, 136, 76);

  // ── 老板桌（大L形）──
  ctx.fillStyle = PALETTE.deskSide;
  ctx.fillRect(x + 60, y + h - 62, 118, 56);
  ctx.fillStyle = PALETTE.deskTop;
  ctx.fillRect(x + 60, y + h - 62, 118, 5);
  // 桌腿（4条）
  ctx.fillStyle = '#5a3520';
  ctx.fillRect(x + 68, y + h - 6, 5, 16);
  ctx.fillRect(x + 165, y + h - 6, 5, 16);
  ctx.fillRect(x + w / 2 + 10, y + h - 6, 5, 16);

  // ── 大显示器（中间）──
  ctx.fillStyle = PALETTE.monitorFrame;
  ctx.fillRect(x + 78, y + h - 112, 80, 54);
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(x + 81, y + h - 109, 74, 48);
  // 屏幕内容：仪表盘
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 86, y + h - 103, 40, 8);
  ctx.fillStyle = '#44ff44';
  ctx.fillRect(x + 86, y + h - 91, 30, 6);
  ctx.fillRect(x + 86, y + h - 81, 50, 6);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 86, y + h - 73, 20, 6);

  // ── 台式电话 ──
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 140, y + h - 50, 18, 14);
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 142, y + h - 48, 14, 10);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 147, y + h - 42, 4, 6);

  // ── 老板座椅（大皮椅）──
  ctx.fillStyle = '#3a2010';
  ctx.fillRect(x + 82, y + h - 5, 72, 32);
  ctx.fillStyle = '#5a3020';
  ctx.fillRect(x + 78, y + h - 10, 80, 8);
  ctx.fillStyle = '#4a2818';
  ctx.fillRect(x + 80, y + h - 15, 76, 8);
  // 扶手
  ctx.fillStyle = '#6b3a20';
  ctx.fillRect(x + 78, y + h - 8, 5, 18);
  ctx.fillRect(x + 153, y + h - 8, 5, 18);
  // 滚轮
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 90, y + h + 27, 4, 6);
  ctx.fillRect(x + 110, y + h + 27, 4, 6);
  ctx.fillRect(x + 130, y + h + 27, 4, 6);
  ctx.fillRect(x + 148, y + h + 27, 4, 6);

  // ── 墙上挂画 ──
  ctx.fillStyle = '#f5f0e9';
  ctx.fillRect(x + 100, y + 56, 40, 28);
  ctx.strokeStyle = '#8B7355';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 100, y + 56, 40, 28);
  ctx.fillStyle = '#4a7a9a';
  ctx.fillRect(x + 108, y + 62, 12, 8);
  ctx.fillStyle = '#3a6a3a';
  ctx.fillRect(x + 122, y + 66, 10, 12);

  ctx.textAlign = 'start';
}

// ═══════════════════════ Server Room ═══════════════════════
// 位置：x=10, y=464, w=350, h=215
function drawServerRoom(ctx, x, y, w, h) {
  // 机房地板（防静电地板）
  ctx.fillStyle = '#14181e';
  ctx.fillRect(x, y, w, h);
  // 架空地板格
  ctx.fillStyle = '#1e2430';
  for (let gx = x + 4; gx < x + w - 4; gx += 14) {
    for (let gy = y + 4; gy < y + h - 4; gy += 14) {
      ctx.fillRect(gx, gy, 12, 12);
    }
  }

  // ── 主服务器机架（左）──
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 10, y + 6, 42, 195);
  // 机架边框
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 10, y + 6, 42, 195);
  // 服务器单元
  for (let u = 0; u < 8; u++) {
    const uy = y + 8 + u * 24;
    // 单元面板
    ctx.fillStyle = u % 2 === 0 ? '#3a3a4a' : '#333340';
    ctx.fillRect(x + 12, uy, 38, 22);
    // 驱动器槽
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 16, uy + 4, 8, 14);
    ctx.fillRect(x + 26, uy + 4, 8, 14);
    ctx.fillRect(x + 36, uy + 4, 8, 14);
    // 把手
    ctx.fillStyle = '#555';
    ctx.fillRect(x + 13, uy + 6, 1, 4);
    ctx.fillRect(x + 13, uy + 14, 1, 4);
    // 指示灯
    const ledOn = (u + Math.floor(Date.now() / 800)) % 3 !== 0;
    ctx.fillStyle = ledOn ? '#44ff44' : '#333';
    ctx.fillRect(x + 15, uy + 10, 2, 2);
    ctx.fillStyle = ledOn ? '#44aaff' : '#333';
    ctx.fillRect(x + 15, uy + 15, 2, 2);
  }

  // ── 副机架（右）──
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 72, y + 6, 42, 195);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 72, y + 6, 42, 195);
  for (let u = 0; u < 8; u++) {
    const uy = y + 8 + u * 24;
    ctx.fillStyle = u % 2 === 0 ? '#3a3a4a' : '#333340';
    ctx.fillRect(x + 74, uy, 38, 22);
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 78, uy + 4, 8, 14);
    ctx.fillRect(x + 88, uy + 4, 8, 14);
    ctx.fillRect(x + 98, uy + 4, 8, 14);
    const ledOn = (u + 2 + Math.floor(Date.now() / 800)) % 3 !== 0;
    ctx.fillStyle = ledOn ? '#44ff44' : '#333';
    ctx.fillRect(x + 77, uy + 10, 2, 2);
    ctx.fillStyle = ledOn ? '#ffaa44' : '#333';
    ctx.fillRect(x + 77, uy + 15, 2, 2);
  }

  // ── 网络交换机（中间上方）──
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(x + 135, y + 20, 50, 60);
  ctx.fillStyle = '#333';
  // 端口排
  for (let p = 0; p < 8; p++) {
    const py = y + 28 + p * 6;
    ctx.fillStyle = p % 2 ? '#44aaff' : '#555';
    ctx.fillRect(x + 145, py, 3, 3);
    ctx.fillRect(x + 155, py, 3, 3);
    ctx.fillRect(x + 165, py, 3, 3);
    ctx.fillRect(x + 175, py, 3, 3);
  }

  // ── UPS 电源（中间下方）──
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 135, y + 140, 50, 55);
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 137, y + 142, 20, 20);
  ctx.fillRect(x + 161, y + 142, 20, 20);
  ctx.fillStyle = '#44ff44';
  ctx.fillRect(x + 145, y + 168, 6, 4);
  ctx.fillRect(x + 169, y + 168, 6, 4);
  ctx.font = '5px "Press Start 2P"';
  ctx.fillStyle = '#44ff44';
  ctx.textAlign = 'center';
  ctx.fillText('UPS', x + 160, y + 184);

  // ── 线缆桥架（上方）──
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 8, y + 4, w - 16, 4);
  // 桥架中的线缆
  for (let lc = x + 12; lc < x + 130; lc += 10) {
    ctx.fillStyle = '#E6A23C';
    ctx.fillRect(lc, y + 6, 3, 1);
    ctx.fillStyle = '#4A90D9';
    ctx.fillRect(lc + 5, y + 6, 3, 1);
  }

  // ── 线缆束（机架间）──
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 54, y + 30, 16, 2);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 54, y + 34, 16, 2);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 54, y + 38, 16, 2);
  // 更多线缆
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 116, y + 50, 16, 2);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 116, y + 54, 16, 2);

  // ── 壁挂空调 ──
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + w - 44, y + 90, 30, 40);
  ctx.fillStyle = '#eee';
  ctx.fillRect(x + w - 42, y + 92, 10, 14);
  ctx.fillRect(x + w - 26, y + 92, 10, 14);
  // 出风口
  ctx.fillStyle = '#bbb';
  ctx.fillRect(x + w - 40, y + 110, 22, 8);
  ctx.fillStyle = '#999';
  for (let s = x + w - 38; s < x + w - 20; s += 5) {
    ctx.fillRect(s, y + 111, 3, 6);
  }

  // ── 警告标识 ──
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 134, y + 90, 52, 20);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '5px "Press Start 2P"';
  ctx.textAlign = 'center';
  ctx.fillText('STAFF', x + 160, y + 100);
  ctx.fillText('ONLY', x + 160, y + 108);

  // ── 标签 ──
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = '#67C23A';
  ctx.textAlign = 'center';
  ctx.fillText('SERVER ROOM', x + w / 2, y + h - 4);
  ctx.textAlign = 'start';
}

function drawServerLights(ctx, phase) {
  const x = 10, y = 464;
  // 在两个机架正面闪烁小LED
  const ledPatterns = [
    [1,1,0,1,0,1,1,0],
    [0,1,1,0,1,0,1,1],
    [1,0,1,1,0,1,0,1],
  ];
  const frameIdx = Math.floor(phase / 3) % ledPatterns.length;
  const leds = ledPatterns[frameIdx];

  for (let i = 0; i < 8; i++) {
    const uy = y + 12 + i * 24;
    ctx.fillStyle = leds[i] ? '#44ff44' : '#333';
    ctx.fillRect(x + 15, uy, 2, 2);
    const led2 = leds[(i + 2) % 8];
    ctx.fillStyle = led2 ? '#44aaff' : '#333';
    ctx.fillRect(x + 77, uy, 2, 2);
  }
}

// ═══════════════════════ Meeting Area ═══════════════════════
// 位置：x=386, y=464, w=324, h=215
function drawMeetingArea(ctx, x, y, w, h) {
  // 地毯（深灰蓝）
  ctx.fillStyle = '#3a4250';
  ctx.fillRect(x, y + 32, w, h - 32);
  ctx.fillStyle = '#2e3540';
  ctx.fillRect(x + 8, y + 38, w - 16, h - 48);

  // ── 投影幕布（墙上正中）──
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + w / 2 - 50, y + 4, 100, 42);
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(x + w / 2 - 46, y + 6, 92, 38);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + w / 2 - 46, y + 6, 92, 38);
  // 幕布卷轴
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + w / 2 - 52, y + 2, 104, 4);
  // 投影内容
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + w / 2 - 34, y + 12, 22, 7);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + w / 2 - 34, y + 23, 44, 5);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + w / 2 + 8, y + 12, 10, 9);

  // ── 白板（侧墙）──
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(x + 8, y + 50, 54, 80);
  ctx.strokeStyle = '#8B7355';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 8, y + 50, 54, 80);
  // 白板笔
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 12, y + 124, 8, 3);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 22, y + 124, 8, 3);
  // 白板擦
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 34, y + 122, 20, 6);
  // 白板内容
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 14, y + 56, 20, 2);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 14, y + 62, 30, 2);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 14, y + 68, 16, 2);

  // ── 会议桌（大椭圆）──
  ctx.fillStyle = PALETTE.meetingTable;
  ctx.fillRect(x + 38, y + 48, w - 76, h - 100);
  // 桌面纹理
  ctx.fillStyle = '#9B8B75';
  ctx.fillRect(x + 38, y + 48, w - 76, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x + 50, y + 56, w - 100, 2);
  ctx.fillRect(x + 50, y + 64, w - 100, 2);

  // 桌腿（4条实木）
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(x + 50, y + h - 52, 6, 20);
  ctx.fillRect(x + w - 56, y + h - 52, 6, 20);
  ctx.fillRect(x + w / 2 - 14, y + h - 52, 6, 20);
  ctx.fillRect(x + w / 2 + 8, y + h - 52, 6, 20);

  // ── 转椅（8把）──
  const chairPositions = [
    // 下排
    { cx: x + 68, cy: y + h - 58 },
    { cx: x + 148, cy: y + h - 58 },
    { cx: x + 228, cy: y + h - 58 },
    // 上排
    { cx: x + 68, cy: y + 36 },
    { cx: x + 148, cy: y + 36 },
    { cx: x + 228, cy: y + 36 },
    // 左右端
    { cx: x + 28, cy: y + 66 },
    { cx: x + w - 54, cy: y + 66 },
  ];
  chairPositions.forEach(cp => {
    // 椅座
    ctx.fillStyle = '#3a3a4a';
    ctx.fillRect(cp.cx, cp.cy, 22, 18);
    // 椅背
    ctx.fillStyle = '#4a4a5a';
    ctx.fillRect(cp.cx - 1, cp.cy - 2, 24, 5);
    // 扶手
    ctx.fillStyle = '#555';
    ctx.fillRect(cp.cx - 2, cp.cy + 2, 3, 12);
    ctx.fillRect(cp.cx + 21, cp.cy + 2, 3, 12);
    // 滚轮
    ctx.fillStyle = '#444';
    ctx.fillRect(cp.cx + 3, cp.cy + 18, 3, 4);
    ctx.fillRect(cp.cx + 16, cp.cy + 18, 3, 4);
  });

  // ── 投影仪（天花板上）──
  ctx.fillStyle = '#555';
  ctx.fillRect(x + w / 2 - 14, y + 44, 28, 10);
  ctx.fillStyle = '#666';
  ctx.fillRect(x + w / 2 - 10, y + 46, 20, 4);
  // 镜头
  ctx.fillStyle = '#88ccff';
  ctx.fillRect(x + w / 2 + 2, y + 47, 4, 3);

  // ── 桌面上物品 ──
  // 笔记本电脑
  ctx.fillStyle = '#333';
  ctx.fillRect(x + w / 2 - 12, y + 62, 24, 16);
  ctx.fillStyle = '#222';
  ctx.fillRect(x + w / 2 - 10, y + 63, 10, 12);
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w / 2 + 2, y + 63, 10, 12);
  // 笔筒
  ctx.fillStyle = '#666';
  ctx.fillRect(x + 54, y + 78, 8, 14);
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 55, y + 80, 2, 10);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 58, y + 80, 2, 10);
  // 水杯
  ctx.fillStyle = '#aaddff';
  ctx.fillRect(x + w - 62, y + 76, 10, 14);
  ctx.fillStyle = '#88bbee';
  ctx.fillRect(x + w - 61, y + 78, 8, 10);

  // ── 植物（角落）──
  drawPlant(ctx, x + w - 22, y + 42);

  // ── 标签 ──
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = '#E6A23C';
  ctx.textAlign = 'center';
  ctx.fillText('MEETING ROOM', x + w / 2, y + h - 4);
  ctx.textAlign = 'start';
}

// ═══════════════════════ Entertainment / Lounge ═══════════════════════
// 位置：x=728, y=464, w=260, h=215
function drawEntertainment(ctx, x, y, w, h) {
  // 地板（暖色木纹）
  ctx.fillStyle = '#3a2a20';
  ctx.fillRect(x, y, w, h);

  // ── 街机（左侧）──
  drawArcade(ctx, x + 8, y + 16, 56, 120);

  // ── 跑步机（中部靠后）──
  drawTreadmill(ctx, x + 78, y + 20, 70, 86);

  // ── 沙发区（右下）──
  // 长沙发
  ctx.fillStyle = '#5a3525';
  ctx.fillRect(x + 140, y + 130, 105, 48);
  ctx.fillStyle = '#6b4535';
  ctx.fillRect(x + 138, y + 126, 109, 10);
  // 沙发坐垫
  ctx.fillStyle = '#7a5545';
  ctx.fillRect(x + 146, y + 138, 32, 24);
  ctx.fillStyle = '#7a5545';
  ctx.fillRect(x + 184, y + 138, 32, 24);
  ctx.fillStyle = '#7a5545';
  ctx.fillRect(x + 222, y + 138, 20, 24);
  // 靠垫
  ctx.fillStyle = '#cc99ff';
  ctx.fillRect(x + 150, y + 132, 14, 8);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 188, y + 132, 14, 8);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 224, y + 132, 12, 8);

  // ── 茶几（沙发前）──
  ctx.fillStyle = '#6b4a30';
  ctx.fillRect(x + 160, y + 178, 64, 22);
  ctx.fillStyle = '#8B6914';
  ctx.fillRect(x + 160, y + 178, 64, 4);
  ctx.fillStyle = '#5a3520';
  ctx.fillRect(x + 166, y + 200, 4, 10);
  ctx.fillRect(x + 214, y + 200, 4, 10);
  // 茶几上的杂志
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 182, y + 174, 16, 6);
  ctx.fillStyle = '#F56C6C';
  ctx.fillRect(x + 200, y + 172, 16, 6);
  // 水杯
  ctx.fillStyle = '#aaddff';
  ctx.fillRect(x + 170, y + 170, 8, 10);

  // ── 咖啡机吧台（左侧靠下）──
  ctx.fillStyle = '#5a4535';
  ctx.fillRect(x + 8, y + 148, 60, 56);
  ctx.fillStyle = '#6b5545';
  ctx.fillRect(x + 8, y + 148, 60, 4);
  // 咖啡机
  ctx.fillStyle = '#444';
  ctx.fillRect(x + 18, y + 154, 28, 28);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 20, y + 156, 24, 14);
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 26, y + 170, 8, 10);
  // 启动灯
  ctx.fillStyle = '#44ff44';
  ctx.fillRect(x + 22, y + 158, 3, 3);
  // 咖啡杯
  drawCoffeeCup(ctx, x + 36, y + 176);
  // 糖罐
  ctx.fillStyle = '#ddd';
  ctx.fillRect(x + 54, y + 160, 10, 12);
  ctx.fillStyle = '#bbb';
  ctx.fillRect(x + 56, y + 158, 6, 4);

  // ── 飞镖靶（墙上右上）──
  ctx.fillStyle = '#2a1a1a';
  ctx.beginPath();
  ctx.arc(x + w - 28, y + 42, 24, 0, Math.PI * 2);
  ctx.fill();
  // 靶心环
  ctx.fillStyle = '#F56C6C';
  ctx.beginPath();
  ctx.arc(x + w - 28, y + 42, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#E6A23C';
  ctx.beginPath();
  ctx.arc(x + w - 28, y + 42, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#67C23A';
  ctx.beginPath();
  ctx.arc(x + w - 28, y + 42, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(x + w - 28, y + 42, 2, 0, Math.PI * 2);
  ctx.fill();

  // 标签
  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = '#cc99ff';
  ctx.textAlign = 'center';
  ctx.fillText('LOUNGE', x + w / 2, y + h - 4);
  ctx.textAlign = 'start';
}

function drawArcade(ctx, x, y, w, h) {
  // 机身
  ctx.fillStyle = '#2d1f4a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3d2f5a';
  ctx.fillRect(x + 2, y + 2, w - 4, 6);

  // 屏幕区域
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(x + 8, y + 12, w - 16, h - 50);
  ctx.strokeStyle = '#cc99ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 8, y + 12, w - 16, h - 50);

  // 操纵杆区域
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 6, y + h - 34, w - 12, 30);

  // 摇杆
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(x + 14, y + h - 28, 3, 12);
  ctx.fillStyle = '#F56C6C';
  ctx.beginPath(); ctx.arc(x + 15, y + h - 28, 5, 0, Math.PI * 2); ctx.fill();

  // 按钮
  ctx.fillStyle = '#4A90D9';
  ctx.beginPath(); ctx.arc(x + 32, y + h - 20, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#67C23A';
  ctx.beginPath(); ctx.arc(x + 44, y + h - 20, 4, 0, Math.PI * 2); ctx.fill();

  // 投币口
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(x + 24, y + h - 14, 12, 6);
  ctx.fillStyle = '#333';
  ctx.fillRect(x + 28, y + h - 14, 4, 6);
}

function drawArcadeScreen(ctx, phase) {
  const x = 736, y = 480;
  const colors = ['#ff44ff', '#44ffff', '#ffff44', '#44ff44', '#ff4444', '#4444ff'];
  const ci = Math.floor(phase / 6) % colors.length;
  ctx.fillStyle = colors[ci];
  ctx.fillRect(x + 18, y + 14, 10, 10);
  ctx.fillRect(x + 32, y + 18, 14, 6);

  const ci2 = Math.floor(phase / 8) % colors.length;
  ctx.fillStyle = colors[ci2];
  ctx.fillRect(x + 12, y + 28, 40, 4);
  ctx.fillRect(x + 18, y + 36, 28, 6);
}

function drawTreadmill(ctx, x, y, w, h) {
  ctx.fillStyle = '#333340';
  ctx.fillRect(x + 4, y + 6, w - 8, h - 8);
  ctx.fillStyle = '#444455';
  ctx.fillRect(x + 4, y + 6, w - 8, 5);

  // 跑带
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + 8, y + 20, w - 16, h - 32);

  // 前支柱
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 10, y + 10, 3, 14);
  ctx.fillRect(x + w - 13, y + 10, 3, 14);
  ctx.fillStyle = '#667';
  ctx.fillRect(x + 4, y + 2, w - 8, 8);
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 6, y + 2, 5, 3);
  ctx.fillRect(x + w - 11, y + 2, 5, 3);
}

function drawTreadmillBelt(ctx, phase) {
  const x = 806, y = 484;
  const offset = Math.floor(phase) % 6;
  ctx.fillStyle = '#222';
  for (let bx = x + 8 + offset; bx < x + 57; bx += 6) {
    ctx.fillRect(bx, y + 20, 4, 28);
  }
}

// ═══════════════════════ 屏幕内容 ═══════════════════════
function drawScreenContent(ctx, dx, dy, dw, agentId) {
  const screenX = dx + dw / 2 - 30;
  const screenY = dy - 42;

  ctx.save();
  ctx.beginPath();
  ctx.rect(screenX + 2, screenY + 2, 56, 38);
  ctx.clip();

  const offset = Math.floor(animTimers.screenScroll) % 60;
  ctx.fillStyle = PALETTE.screenCode;
  ctx.font = '6px monospace';

  // 代码行滚动
  const codeLines = [
    'import { World }',
    'const app = new',
    'engine.start()',
    'agent.connect',
    'await deploy(',
    '  .then(res =>',
    '  .catch(err',
    'verify(proof)',
    'return result',
    '// @ts-check',
  ];
  for (let i = 0; i < 8; i++) {
    const idx = (i + Math.floor(offset / 8)) % codeLines.length;
    ctx.fillText(codeLines[idx], screenX + 4, screenY + 8 + i * 5);
  }
  ctx.restore();
}

// ═══════════════════════ 咖啡机蒸汽 ═══════════════════════
function drawCoffeeSteam(ctx, phase) {
  const sx = 754, sy = 618;
  const steamOffsets = [
    Math.sin(phase) * 4,
    Math.sin(phase + 1.5) * 3,
    Math.sin(phase + 3) * 5,
  ];
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  steamOffsets.forEach((offset, i) => {
    const alpha = 0.1 + Math.abs(Math.cos(phase + i)) * 0.15;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(sx + offset - 4, sy - 8 - i * 8, 8, 6);
    ctx.fillRect(sx + offset + 4, sy - 12 - i * 8, 6, 8);
  });
}

// ═══════════════════════ 饮水机气泡 ═══════════════════════
function drawWaterBubbles(ctx, phase) {
  const bx = 220, by = 470;
  for (let i = 0; i < 3; i++) {
    const bPhase = (phase + i * 13) % 40;
    if (bPhase < 20) {
      const alpha = 1 - bPhase / 20;
      ctx.fillStyle = `rgba(74,144,217,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(bx + 12 + Math.sin(bPhase) * 2, by - bPhase * 0.8, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ═══════════════════════ 动画时钟 ═══════════════════════
function drawAnimatedClock(ctx, minutePhase, hourPhase) {
  const cx = 500, cy = 22;
  // 表盘
  ctx.fillStyle = '#f5f0e9';
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.stroke();

  // 分针（快转）
  const minAngle = (minutePhase % 40) / 40 * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(minAngle) * 10, cy + Math.sin(minAngle) * 10);
  ctx.stroke();

  // 时针（慢转）
  const hourAngle = (hourPhase % 240) / 240 * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = '#666'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(hourAngle) * 7, cy + Math.sin(hourAngle) * 7);
  ctx.stroke();

  // 中心点
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
}

// ═══════════════════════ 天花板灯 ═══════════════════════
function drawCeilingLights(ctx) {
  for (let lx = 60; lx < CANVAS_W; lx += 180) {
    ctx.fillStyle = 'rgba(255,255,200,0.08)';
    ctx.fillRect(lx, 0, 60, 8);
    ctx.fillStyle = 'rgba(255,255,200,0.04)';
    ctx.fillRect(lx + 2, 8, 56, 24);
  }
}

// ═══════════════════════ 通用组件 ═══════════════════════
function drawMonitor(ctx, x, y, w, h) {
  // 支架
  ctx.fillStyle = '#444';
  ctx.fillRect(x + w / 2 - 3, y + h, 6, 8);
  ctx.fillRect(x + w / 2 - 10, y + h + 6, 20, 4);

  // 外框
  ctx.fillStyle = PALETTE.monitorFrame;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  // 屏幕
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(x, y, w, h);

  // 代码行（静态预览）
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 3, y + 4, 18, 2);
  ctx.fillRect(x + 3, y + 9, 30, 2);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(x + 3, y + 9, 6, 2);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 3, y + 14, 12, 2);
  ctx.fillRect(x + 3, y + 19, 25, 2);
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

function drawChair(ctx, x, y, w, h) {
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(x - 2, y - 4, w + 4, 8);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 4, y + h, 3, 8);
  ctx.fillRect(x + w - 7, y + h, 3, 8);
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
}

function drawPlant(ctx, x, y) {
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(x, y + 14, 18, 16);
  ctx.fillStyle = '#A0522D';
  ctx.fillRect(x - 2, y + 12, 22, 4);
  ctx.fillStyle = '#2d8b4a';
  ctx.fillRect(x + 5, y, 8, 14);
  ctx.fillRect(x - 2, y + 4, 8, 6);
  ctx.fillRect(x + 12, y + 4, 8, 6);
  ctx.fillStyle = '#3daa5a';
  ctx.fillRect(x + 6, y + 2, 6, 8);
}

function drawWaterDispenser(ctx, x, y) {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(x, y, 24, 40);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(x + 2, y + 2, 20, 36);
  ctx.fillStyle = '#b8d8f0';
  ctx.fillRect(x + 3, y - 8, 18, 14);
  ctx.fillStyle = '#c8e4f8';
  ctx.fillRect(x + 3, y - 8, 18, 4);
  ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 3, y - 8, 18, 14);
  ctx.fillStyle = '#555';
  ctx.fillRect(x + 6, y + 16, 12, 4);
  ctx.fillStyle = '#E84040';
  ctx.fillRect(x + 10, y + 20, 4, 5);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(x + 4, y + 22, 4, 5);
  ctx.fillStyle = '#aaa';
  ctx.fillRect(x + 2, y + 28, 20, 4);
  ctx.fillStyle = '#ccc';
  ctx.fillRect(x - 1, y + 36, 26, 5);
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

      // 眨眼效果：如果 blinkState > 0 且是眼睛行，变暗
      let colorVal = val;
      if (charState.blinkState > 0 && [3, 4, 5].includes(row) &&
          (grid === CCLAWD_GRID || grid === CX_GRID)) {
        if (val === 6 || val === 4) continue; // 跳过眼槽行
      }
      if (charState.blinkState > 0 && [3, 4].includes(row) && grid === MARVIS_GRID) {
        if (val === 4) colorVal = 3; // 闭眼
      }

      ctx.fillStyle = COLOR_MAP[colorVal] || COLOR_MAP[1];
      ctx.fillRect(x + offsetX + col * CELL_SIZE, y + offsetY + row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
  ctx.restore();
}

// ═══════════════════════ 笔记本 ═══════════════════════
function drawLaptopOnDesk(ctx, deskId) {
  const pos = LAPTOP_POSITIONS[deskId];
  if (!pos) return;
  if (!laptopAnimTimers[deskId]) laptopAnimTimers[deskId] = 0;
  laptopAnimTimers[deskId] += 0.016;
  const glowAlpha = 0.08 + Math.sin(laptopAnimTimers[deskId] * 3) * 0.04;

  ctx.fillStyle = `rgba(74, 144, 217, ${glowAlpha})`;
  ctx.fillRect(pos.x - 8, pos.y - 4, 44, 32);

  ctx.fillStyle = '#2a2a4a';
  ctx.fillRect(pos.x, pos.y, 28, 18);
  ctx.strokeStyle = '#4a4a6a'; ctx.lineWidth = 0.5;
  ctx.strokeRect(pos.x, pos.y, 28, 18);

  ctx.fillStyle = '#1a2a4a';
  ctx.fillRect(pos.x + 2, pos.y + 1, 24, 14);
  ctx.fillStyle = '#4A90D9';
  ctx.fillRect(pos.x + 4, pos.y + 3, 14, 1.5);
  ctx.fillStyle = '#67C23A';
  ctx.fillRect(pos.x + 4, pos.y + 6, 10, 1.5);
  ctx.fillStyle = '#E6A23C';
  ctx.fillRect(pos.x + 4, pos.y + 9, 16, 1.5);

  const blink = Math.floor(Date.now() / 500) % 2;
  if (blink) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(pos.x + 18, pos.y + 9, 3, 1.5);
  }

  ctx.fillStyle = '#444';
  ctx.fillRect(pos.x - 2, pos.y + 18, 32, 6);
  ctx.fillStyle = '#555';
  for (let kx = 0; kx < 8; kx++) {
    ctx.fillRect(pos.x + kx * 3.5, pos.y + 19, 2.5, 2.5);
  }
}

// ═══════════════════════ 气泡绘制 ═══════════════════════
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
  // 气泡只在空闲/讨论时显示，不显示工作细节
  if (agent.status !== 'idle' && agent.status !== 'talking') return;
  const text = agent.activity || (agent.status === 'idle' ? '等任务...' : '');
  if (!text) return;

  const icon = agent.status === 'talking' ? BUBBLE_ICONS.talking : BUBBLE_ICONS.idle;
  const colors = agent.status === 'talking' ? BUBBLE_COLORS.talking : BUBBLE_COLORS.idle;

  const displayText = `${icon} ${text}`;

  ctx.font = '11px "Press Start 2P"';
  const textWidth = ctx.measureText(displayText).width;
  const bubbleW = Math.max(textWidth + 24, 80);
  const bubbleH = 28;
  const bx = x - bubbleW / 2 + 45;
  const by = y;

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = 6;

  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(bx, by, bubbleW, bubbleH, 6); ctx.fill(); ctx.stroke();

  ctx.shadowBlur = 0;

  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.moveTo(bx + bubbleW / 2 - 6, by + bubbleH);
  ctx.lineTo(bx + bubbleW / 2, by + bubbleH + 8);
  ctx.lineTo(bx + bubbleW / 2 + 6, by + bubbleH);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(displayText, bx + 12, by + 18);
}

function drawCircularProgress(ctx, cx, cy, radius, percent, color) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (percent > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * percent);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  ctx.font = '7px "Press Start 2P"';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(percent * 100) + '%', cx, cy + 3);
  ctx.textAlign = 'start';
}
