import { readFileSync, writeFileSync } from 'fs';

const TARGET = 'D:/BKS/projects/team-workspace/src/sdk/ai-reply.js';
let content = readFileSync(TARGET, 'utf8');

// Fix the double-escaped backslash in fixTruncatedJson
// Current (wrong): '\\\\'  →  two backslashes in string
// Correct:          '\\'    →  single backslash in string
// In the source file, the wrong version appears as: !== '\\\\'
// We need to change it to: !== '\\'
// But careful: in the actual file bytes, '\\\\' is the literal text \\\\ (4 chars: \, \, \, \)

// The pattern in ai-reply.js is: !== '\\\\'
// But that's confusing. Let me just rebuild the function correctly.

// Find fixTruncatedJson function boundaries
const funcStart = content.indexOf('function fixTruncatedJson(jsonStr, source)');
const funcEnd = content.indexOf('\nasync function callAnthropic', funcStart);

if (funcStart !== -1 && funcEnd !== -1) {
  const correctFunc = `
/**
 * Fix truncated JSON by closing unclosed strings and balancing brackets.
 * Used when API response is cut off due to model output truncation.
 * @param {string} jsonStr - Raw JSON string from API response
 * @param {string} source - Label for logging (e.g. 'OpenAI', 'Anthropic')
 * @returns {object} Parsed JSON object
 */
function fixTruncatedJson(jsonStr, source) {
  source = source || 'API';
  // First try direct parse
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[AI] JSON parse failed (' + source + '), attempting truncation fix:', e.message);
    
    let fixed = jsonStr;
    
    // Fix 1: Close unclosed string (Unterminated string in JSON)
    if (e.message.indexOf('Unterminated string') !== -1) {
      const posMatch = e.message.match(/position (\\d+)/);
      if (posMatch) {
        const pos = parseInt(posMatch[1]);
        let inString = false;
        for (let i = 0; i < Math.min(pos, fixed.length); i++) {
          if (fixed[i] === '"' && (i === 0 || fixed[i-1] !== '\\\\')) {
            inString = !inString;
          }
        }
        if (inString) {
          fixed = fixed.substring(0, pos) + '"' + fixed.substring(pos);
        }
      }
    }
    
    // Fix 2: Balance braces and brackets (Unexpected end of JSON input)
    if (e.message.indexOf('Unexpected end of JSON input') !== -1 || e.message.indexOf('Unterminated string') !== -1) {
      let braceCount = 0;
      let bracketCount = 0;
      let inString = false;
      for (let i = 0; i < fixed.length; i++) {
        const ch = fixed[i];
        if (ch === '"' && (i === 0 || fixed[i-1] !== '\\\\')) {
          inString = !inString;
        }
        if (!inString) {
          if (ch === '{') braceCount++;
          if (ch === '}') braceCount--;
          if (ch === '[') bracketCount++;
          if (ch === ']') bracketCount--;
        }
      }
      if (inString) { fixed += '"'; }
      while (bracketCount > 0) { fixed += ']'; bracketCount--; }
      while (braceCount > 0) { fixed += '}'; braceCount--; }
    }
    
    try {
      const result = JSON.parse(fixed);
      console.warn('[AI] JSON truncated, auto-fixed successfully (' + source + ')');
      return result;
    } catch (e2) {
      console.error('[AI] JSON fix failed (' + source + '):', e2.message);
      throw new Error('API response parse failed after fix attempt: ' + e2.message);
    }
  }
}
`;

  content = content.substring(0, funcStart) + correctFunc + '\n' + content.substring(funcEnd);
  writeFileSync(TARGET, content, 'utf8');
  console.log('Fixed escape sequences in fixTruncatedJson');
} else {
  console.error('Could not find function boundaries');
}
