const fs = require('fs');
const p = 'D:/BKS/projects/team-workspace/src/workers/cx-listener.mjs';
let c = fs.readFileSync(p, 'utf8');
console.log('Size:', c.length);

// 1. Add currentModel after MODEL_TIERS closing
let replaced = c.replace(
  '  },\n};',
  '  },\n};\n\n// ── 当前模型跟踪（用于心跳上报）──\nlet currentModel = "glm-4.7-flash";'
);
console.log('Replace1:', replaced !== c);

// 2. Add getModel to createAgent
c = replaced;
replaced = c.replace(
  "  color: '#10A37F',\n  gridFile: 'grids/cx.js',\n});",
  "  color: '#10A37F',\n  gridFile: 'grids/cx.js',\n  getModel: () => currentModel,\n});"
);
console.log('Replace2:', replaced !== c);

// 3. Update currentModel when modelOverride is first set
c = replaced;
replaced = c.replace(
  '    let modelOverride = isCodeTask ? { ...MODEL_TIERS.code } : { ...MODEL_TIERS.volcFlash };\n    if (isCodeTask)',
  '    let modelOverride = isCodeTask ? { ...MODEL_TIERS.code } : { ...MODEL_TIERS.volcFlash };\n    currentModel = modelOverride.openaiModel;\n    if (isCodeTask)'
);
console.log('Replace3:', replaced !== c);

// 4. Update currentModel when modelOverride changes in fallback chain  
c = replaced;
replaced = c.replace(
  '      modelOverride = { ...tier };\n      try {\n        console.log(`[CX] 尝试 ${name} (${modelOverride.openaiModel})`);',
  '      modelOverride = { ...tier };\n      currentModel = modelOverride.openaiModel;\n      try {\n        console.log(`[CX] 尝试 ${name} (${modelOverride.openaiModel})`);'
);
console.log('Replace4:', replaced !== c);

fs.writeFileSync(p, replaced, 'utf8');
console.log('Done');
