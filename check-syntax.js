const fs = require('fs');
const code = fs.readFileSync('src/browser.html', 'utf8');
const scriptMatch = code.match(/<script>([\s\S]*?)<\/script>/);
if(!scriptMatch) {
  console.log('No script match');
  process.exit(1);
}
const script = scriptMatch[1];
const lines = script.split('\n');
let depth = 0;
let parenDepth = 0;
let inString = false;
let stringChar = null;
let inTemplate = false;
let inComment = false;
let inRegex = false;
for(let i=0; i<script.length; i++) {
  const ch = script[i];
  const next = script[i+1];
  if(inComment) {
    if(ch === '\n') inComment = false;
    continue;
  }
  if(inString) {
    if(ch === '\\') { i++; continue; }
    if(ch === stringChar) inString = false;
    continue;
  }
  if(inTemplate) {
    if(ch === '`') { inTemplate = false; continue; }
    if(ch === '\\') { i++; continue; }
    continue;
  }
  if(inRegex) {
    if(ch === '\\') { i++; continue; }
    if(ch === '/') { inRegex = false; continue; }
    continue;
  }
  if(ch === '/' && next === '/') { inComment = true; i++; continue; }
  if(ch === '/' && next === '*') { inComment = true; i++; continue; }
  if(ch === '\'' || ch === '"') { inString = true; stringChar = ch; continue; }
  if(ch === '`') { inTemplate = true; continue; }
  if(ch === '/' && depth === 0 && parenDepth === 0 && (i === 0 || /[\x00-\x20(,=!]/.test(script[i-1]))) {
    inRegex = true; continue;
  }
  if(ch === '(') parenDepth++;
  else if(ch === ')') parenDepth--;
  else if(ch === '{') depth++;
  else if(ch === '}') depth--;
  if(parenDepth < 0) { console.log('PAREN negative at char', i, ':', script.substring(Math.max(0,i-30), i+30)); process.exit(1); }
  if(depth < 0) { console.log('BRACE negative at char', i, ':', script.substring(Math.max(0,i-30), i+30)); process.exit(1); }
}
console.log('Final depth:', depth, 'Final parenDepth:', parenDepth);
if(depth === 0 && parenDepth === 0) console.log('ALL BALANCED!');
else console.log('IMBALANCE!');
