const fs = require('fs');
const code = fs.readFileSync('src/browser.html', 'utf8');
const scriptMatch = code.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch[1];
let depth = 0;
let lineNum = 1;
for (let i = 0; i < script.length; i++) {
  const ch = script[i];
  if (ch === '\n') lineNum++;
  else if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth < 0) {
      console.log('NEGATIVE at line', lineNum);
      console.log('Context:', script.substring(Math.max(0,i-80), i+80));
      process.exit(1);
    }
  }
}
console.log('Final depth:', depth);
console.log('Final line:', lineNum);
