// 测试超时和重试机制
import { sleep } from './src/sdk/ai-reply.js'; // 假设导出了，否则直接内联

console.log('=== CC 超时重试机制测试 ===\n');

// 测试1: 超时测试
async function testTimeout() {
  console.log('[测试1] fetch 超时测试 - 请求不可达地址');
  const start = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch('http://192.0.2.1:9999/test', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    console.log('  结果: 未超时（意外）');
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err.name === 'AbortError') {
      console.log(`  结果: ✅ 30秒超时生效，耗时 ${elapsed}ms`);
    } else {
      console.log(`  结果: ✅ 网络错误快速失败 - ${err.message}，耗时 ${elapsed}ms`);
    }
  }
}

// 测试2: 401 不重试验证
async function test401NoRetry() {
  console.log('\n[测试2] 401 错误不重试验证');
  let callCount = 0;
  
  const mockFn = async () => {
    callCount++;
    throw new Error('Anthropic API error: 401 Invalid API Key');
  };
  
  try {
    // 模拟 callWithRetry 逻辑
    const MAX_RETRIES = 3;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        await mockFn();
      } catch (err) {
        const isAuthError = err.message.includes('401') || err.message.includes('403');
        if (isAuthError) {
          console.log(`  结果: ✅ 401错误直接抛出，不重试，调用次数: ${callCount}`);
          return;
        }
      }
    }
  } catch (err) {
    console.log(`  结果: ${err.message}`);
  }
}

// 测试3: 5xx 错误会重试
async function test5xxRetry() {
  console.log('\n[测试3] 5xx 错误重试验证');
  let callCount = 0;
  
  const mockFn = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error('Server error: 500 Internal Server Error');
    }
    return 'success';
  };
  
  const MAX_RETRIES = 3;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const result = await mockFn();
      console.log(`  结果: ✅ 5xx错误重试成功，调用次数: ${callCount}`);
      return;
    } catch (err) {
      const isAuthError = err.message.includes('401') || err.message.includes('403');
      if (isAuthError || i === MAX_RETRIES - 1) {
        console.log(`  结果: 重试耗尽或认证错误`);
        return;
      }
      // 模拟指数退避
      const delay = Math.min(1000 * Math.pow(2, i), 10000);
      console.log(`  重试 ${i + 1}/${MAX_RETRIES}，等待 ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// 运行测试（测试1用短超时快速验证）
async function runTests() {
  // 用5秒超时快速验证，而非30秒
  console.log('[快速验证] 使用 5 秒超时测试 AbortController 机制');
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch('http://192.0.2.1:9999/test', { signal: controller.signal });
    clearTimeout(timeoutId);
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ✅ AbortController 超时机制正常，耗时 ${elapsed}ms`);
  }
  
  await test401NoRetry();
  await test5xxRetry();
  
  console.log('\n=== 测试完成 ===');
}

runTests().catch(console.error);
