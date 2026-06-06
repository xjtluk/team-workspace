import { readFileSync, writeFileSync } from 'fs';

const TARGET = 'D:/BKS/projects/team-workspace/src/sdk/ai-reply.js';
let content = readFileSync(TARGET, 'utf8');

console.log('Original length:', content.length);

// ============================================================
// STEP 1: Add fixTruncatedJson function before callAnthropic
// ============================================================
const fixFunc = `

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

// Insert before 'async function callAnthropic'
const anthropicMarker = 'async function callAnthropic(systemPrompt, messages, useTools, config) {';
if (content.includes(anthropicMarker)) {
  content = content.replace(anthropicMarker, fixFunc + anthropicMarker);
  console.log('STEP 1: fixTruncatedJson inserted before callAnthropic');
} else {
  console.error('STEP 1 FAILED: callAnthropic marker not found');
}

// ============================================================
// STEP 2: Replace response.json() in callOpenAI
// ============================================================
const openaiJsonMarker = '  const data = await response.json();';
const openaiJsonReplacement = [
  '  // Use text() + fixTruncatedJson to handle truncated API responses',
  '  const responseTextOA = await response.text();',
  '  const data = fixTruncatedJson(responseTextOA, \'OpenAI\');'
].join('\n');

if (content.includes(openaiJsonMarker)) {
  content = content.replace(openaiJsonMarker, openaiJsonReplacement);
  console.log('STEP 2: response.json() replaced in callOpenAI');
} else {
  console.error('STEP 2 FAILED: response.json() marker not found');
}

// ============================================================
// STEP 3: Replace JSON.parse try-catch in callAnthropic
// ============================================================
// Find the block: let data; try { data = JSON.parse(responseText); } catch ... throw ...
const startMarker = '\n  let data;\n  try {\n    data = JSON.parse(responseText);\n  } catch (parseErr)';

const startIdx = content.indexOf(startMarker);
if (startIdx !== -1) {
  // Find the entire catch block by counting braces
  // After 'catch (parseErr) {' find matching '}'
  let braceDepth = 0;
  let inCatch = false;
  let catchOpenIdx = -1;
  let catchCloseIdx = -1;
  
  // First find the opening brace of catch
  const afterCatch = content.indexOf('{', content.indexOf('catch (parseErr)', startIdx));
  if (afterCatch !== -1) {
    for (let i = afterCatch; i < content.length; i++) {
      if (content[i] === '{') { braceDepth++; inCatch = true; }
      if (content[i] === '}') {
        braceDepth--;
        if (inCatch && braceDepth === 0) {
          catchCloseIdx = i;
          break;
        }
      }
    }
  }
  
  if (catchCloseIdx !== -1) {
    // Find the following lines: console.error and throw new Error
    // The catch body should be: { ... console.error ... throw new Error ... }
    // After catchCloseIdx, we might have console.error and throw on subsequent lines
    // Look for throw statement
    let searchFrom = catchCloseIdx + 1;
    let throwIdx = content.indexOf('throw new Error(', searchFrom);
    
    // Also check if there's another brace or statement
    // Find the end of the throw line
    let endIdx;
    if (throwIdx !== -1 && throwIdx - catchCloseIdx < 300) {
      // Find semicolon after throw
      let semiIdx = content.indexOf(';', throwIdx);
      if (semiIdx !== -1) {
        // Find next newline
        let nlIdx = content.indexOf('\n', semiIdx);
        endIdx = nlIdx !== -1 ? nlIdx + 1 : semiIdx + 1;
      } else {
        endIdx = throwIdx + 100; // fallback
      }
    } else {
      // No throw found nearby - just cut after the catch close
      endIdx = catchCloseIdx + 1;
    }
    
    const replacement = '\n  const data = fixTruncatedJson(responseText, \'Anthropic\');\n';
    content = content.substring(0, startIdx) + replacement + content.substring(endIdx);
    console.log('STEP 3: JSON.parse try-catch replaced in callAnthropic');
    console.log('  Old block length:', endIdx - startIdx);
    console.log('  New block length:', replacement.length);
  } else {
    console.error('STEP 3 FAILED: catch close brace not found');
  }
} else {
  console.error('STEP 3 FAILED: start marker not found');
  // Debug: show context around JSON.parse(responseText)
  const dbgIdx = content.indexOf('JSON.parse(responseText)');
  if (dbgIdx !== -1) {
    console.log('  Found JSON.parse(responseText) at index', dbgIdx);
    console.log('  Context:', JSON.stringify(content.substring(dbgIdx - 30, dbgIdx + 50)));
  }
}

// Write result
writeFileSync(TARGET, content, 'utf8');
console.log('New length:', content.length);
console.log('DONE');
