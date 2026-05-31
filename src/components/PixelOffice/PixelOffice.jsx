import { useRef, useEffect } from 'preact/hooks';
import { CCLAWD_GRID, MARVIS_GRID, COLOR_MAP, GRID_REGISTRY } from '../../grids/CharacterGrids.js';

const CELL_SIZE = 6;

// 区域坐标
const LOCATIONS = {
  desk: { x: 350, y: 180 },
  sofa: { x: 120, y: 320 },
  bug:  { x: 580, y: 320 },
};

export function PixelOffice({ agents }) {
  const canvasRef = useRef(null);
  const gameLoopRef = useRef(null);
  const agentsRef = useRef(agents);

  // 保持 agents 引用最新
  agentsRef.current = agents;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const gameLoop = () => {
      const currentAgents = agentsRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 背景
      drawBackground(ctx, canvas.width, canvas.height);

      // 角色
      Object.values(currentAgents).forEach(agent => {
        if (!agent.online || agent.id === 'kk') return; // KK 不渲染像素角色
        const grid = GRID_REGISTRY[agent.id];
        if (!grid) return;
        const pos = LOCATIONS[agent.location] || LOCATIONS.sofa;
        drawCharacter(ctx, grid, pos.x, pos.y, agent);
        drawBubble(ctx, agent, pos.x, pos.y - 40);
      });

      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoop();
    return () => cancelAnimationFrame(gameLoopRef.current);
  }, []);

  return <canvas ref={canvasRef} width={800} height={500} class="pixel-canvas" />;
}

function drawBackground(ctx, w, h) {
  // 深色地板
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, w, h);

  // 墙壁
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, w, 120);

  // 工作区桌子
  ctx.fillStyle = '#3d2b1f';
  ctx.fillRect(300, 160, 160, 60);
  ctx.fillStyle = '#5c3d2e';
  ctx.fillRect(300, 160, 160, 8);

  // 沙发（休息区）
  ctx.fillStyle = '#2d1f3d';
  ctx.fillRect(60, 300, 160, 50);
  ctx.fillStyle = '#3d2f4d';
  ctx.fillRect(60, 300, 160, 10);

  // 调试区（bug 标志）
  ctx.fillStyle = '#3d1f1f';
  ctx.fillRect(530, 300, 140, 50);
  ctx.fillStyle = '#4d2f2f';
  ctx.fillRect(530, 300, 140, 10);

  // 区域标签
  ctx.font = '8px "Press Start 2P"';
  ctx.fillStyle = '#666';
  ctx.fillText('WORKSPACE', 320, 150);
  ctx.fillText('LOUNGE', 90, 290);
  ctx.fillText('DEBUG', 560, 290);
}

function drawCharacter(ctx, grid, x, y, agent) {
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const val = grid[row][col];
      if (val === 0) continue;
      ctx.fillStyle = COLOR_MAP[val];
      ctx.fillRect(x + col * CELL_SIZE, y + row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }
  }
}

function drawBubble(ctx, agent, x, y) {
  if (!agent.activity && agent.status !== 'offline') return;

  const text = agent.status === 'offline' ? '离线中' : agent.activity;
  if (!text) return;

  ctx.font = '8px "Press Start 2P"';
  const textWidth = ctx.measureText(text).width;
  const bubbleW = textWidth + 16;
  const bubbleH = 22;
  const bx = x - bubbleW / 2 + 30;

  // 气泡背景
  ctx.fillStyle = '#2D2D2D';
  ctx.strokeStyle = agent.status === 'error' ? '#F56C6C' : '#4A90D9';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, y, bubbleW, bubbleH, 4);
  ctx.fill();
  ctx.stroke();

  // 文字
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(text, bx + 8, y + 14);

  // 进度条
  if (agent.status === 'working' && agent.progress > 0) {
    const barW = bubbleW - 16;
    const barX = bx + 8;
    const barY = y + bubbleH + 4;
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barW, 4);
    ctx.fillStyle = '#67C23A';
    ctx.fillRect(barX, barY, barW * (agent.progress / 100), 4);
  }
}
