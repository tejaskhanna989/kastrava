const fs = require('fs');
const code = fs.readFileSync('src/browser.html', 'utf8');
const scriptMatch = code.match(/<script>([\s\S]*?)<\/script>/);
const script = scriptMatch[1];
let depth = 0;
let lineNum = 1;
let minDepth = 0;
let minDepthLine = 1;
for (let i = 0; i < script.length; i++) {
  const ch = script[i];
  if (ch === '\n') lineNum++;
  else if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth < minDepth) {
      minDepth = depth;
      minDepthLine = lineNum;
    }
  }
}
console.log('Final depth:', depth);
console.log('Min depth:', minDepth, 'at line:', minDepthLine);
// Print context around that line
const lines = script.split('\n');
console.log('Context line', minDepthLine + ':', lines[minDepthLine - 1]);
console.log('Context line', minDepthLine + 2 + ':', lines[minDepthLine + 1]);
console.log('Context line', minDepthLine + 3 + ':', lines[minDepthLine + 2]);
