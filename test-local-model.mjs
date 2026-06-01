#!/usr/bin/env node
/**
 * 测试本地模型 API 是否可用
 * 支持 Ollama (端口 11434) 和 llama.cpp (端口 8080)
 */

const OLLAMA_URL = 'http://localhost:11434';
const LLAMACPP_URL = 'http://localhost:8080/v1';

async function testOllama() {
  console.log('测试 Ollama...');

  try {
    // 检查 Ollama 服务
    const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!tagsRes.ok) {
      console.log('Ollama 服务未运行');
      return false;
    }

    const tags = await tagsRes.json();
    const models = tags.models?.map(m => m.name) || [];
    console.log('可用模型:', models);

    if (models.length === 0) {
      console.log('没有下载的模型，请运行: ollama pull qwen2.5:3b');
      return false;
    }

    // 测试聊天
    console.log('\n测试聊天...');
    const chatRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:3b',
        messages: [
          { role: 'system', content: '你是小马，BKS 项目部 Leader。简短回复。' },
          { role: 'user', content: '你好，测试一下' },
        ],
        stream: false,
      }),
    });

    if (chatRes.ok) {
      const data = await chatRes.json();
      const content = data.message?.content;
      console.log('回复:', content);
      console.log('\nOllama 可用！');
      return true;
    } else {
      const err = await chatRes.text();
      console.log('聊天测试失败:', err);
      return false;
    }
  } catch (err) {
    console.log('Ollama 连接失败:', err.message);
    return false;
  }
}

async function testLlamaCpp() {
  console.log('\n测试 llama.cpp...');

  try {
    // 检查 llama.cpp 服务
    const modelsRes = await fetch(`${LLAMACPP_URL}/models`);
    if (!modelsRes.ok) {
      console.log('llama.cpp 服务未运行');
      return false;
    }

    const models = await modelsRes.json();
    console.log('可用模型:', models.data?.map(m => m.id) || '无');

    // 测试聊天
    console.log('\n测试聊天...');
    const chatRes = await fetch(`${LLAMACPP_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer local',
      },
      body: JSON.stringify({
        model: 'local-model',
        max_tokens: 100,
        messages: [
          { role: 'system', content: '你是小马，BKS 项目部 Leader。简短回复。' },
          { role: 'user', content: '你好，测试一下' },
        ],
      }),
    });

    if (chatRes.ok) {
      const data = await chatRes.json();
      const content = data.choices?.[0]?.message?.content;
      console.log('回复:', content);
      console.log('\nllama.cpp 可用！');
      return true;
    } else {
      const err = await chatRes.text();
      console.log('聊天测试失败:', err);
      return false;
    }
  } catch (err) {
    console.log('llama.cpp 连接失败:', err.message);
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('测试本地模型');
  console.log('========================================\n');

  const ollamaOk = await testOllama();
  const llamaCppOk = await testLlamaCpp();

  console.log('\n========================================');
  console.log('测试结果:');
  console.log('- Ollama:', ollamaOk ? '可用' : '不可用');
  console.log('- llama.cpp:', llamaCppOk ? '可用' : '不可用');
  console.log('========================================');

  if (!ollamaOk && !llamaCppOk) {
    console.log('\n没有可用的本地模型。请：');
    console.log('1. 安装 Ollama: https://ollama.com/download');
    console.log('2. 下载模型: ollama pull qwen2.5:3b');
    console.log('3. 或者运行 setup-local-model.bat');
  }
}

main();
