import WebSocket from 'ws';

let wsToken = '';
try {
  const res = await fetch('http://127.0.0.1:3210/api/auth/token');
  const data = await res.json();
  wsToken = data.token || '';
} catch (e) {
  console.error('获取 token 失败:', e.message);
}

console.log('Token:', wsToken.substring(0, 10) + '...');

const ws = new WebSocket(`ws://localhost:3210/ws?token=${wsToken}`);

ws.on('open', () => {
  console.log('WebSocket 已连接');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('收到消息类型:', msg.type, msg.payload?.content?.substring(0, 50));
});

ws.on('error', (err) => {
  console.error('WebSocket 错误:', err.message);
});

ws.on('close', (code) => {
  console.log('WebSocket 断开:', code);
});

// 60秒后退出
setTimeout(() => {
  console.log('测试结束');
  ws.close();
  process.exit(0);
}, 60000);
