import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), 'src');

const fileExtensions = new Set(['.ts', '.vue', '.js', '.json']);
const ignoredDirs = new Set(['dist', 'node_modules']);
const ignoredFiles = new Set(['i18n/index.ts']);
const allowComment = 'i18n-check-allow avatar-initial';

const chineseIconPattern =
  /\b(?:icon|iconText|fallbackIcon|avatar)\s*:\s*['"`][订单我城付餐篮信聊讯址电话菜藏商收地铃设资]['"`]/;
const firstCharPattern = /\b(?:slice\s*\(\s*0\s*,\s*1\s*\)|charAt\s*\(\s*0\s*\)|firstChar\s*\()/;
const templateChinesePattern = />\s*[\u4e00-\u9fff]{2,}[^<]*</;
const placeholderChinesePattern = /\bplaceholder\s*=\s*['"`][\u4e00-\u9fff]{2,}[^'"`]*['"`]/;
const toastModalStartPattern = /uni\.(showToast|showModal)\s*\(/g;
const localizedWrapperPattern =
  /\b(?:checkoutText|t|translateApiError|localizedName|localizedText|merchantName|productName|productSubtitle|productSnapshotName|categoryName)\s*\(/;
const localeBranchPattern =
  /\blocale(?:\.value)?\s*===\s*['"`](?:zh|vi|en)['"`]\s*\?/;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const nextPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(nextPath));
      continue;
    }
    const relativePath = path.relative(rootDir, nextPath).replaceAll('\\', '/');
    if (ignoredFiles.has(relativePath)) continue;
    if (fileExtensions.has(path.extname(entry.name))) files.push(nextPath);
  }
  return files;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function shorten(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function isAvatarInitialAllowed(lines, lineNumber) {
  const current = lines[lineNumber - 1] ?? '';
  const previous = lines[lineNumber - 2] ?? '';
  const next = lines[lineNumber] ?? '';
  return [previous, current, next].some((line) => line.includes(allowComment));
}

function pushFinding(findings, file, line, label, snippet) {
  findings.push({
    file: path.relative(process.cwd(), file),
    line,
    label,
    snippet: shorten(snippet),
  });
}

function scanToastAndModal(findings, file, content) {
  for (const match of content.matchAll(toastModalStartPattern)) {
    const startIndex = match.index ?? 0;
    const endIndex = Math.min(content.length, startIndex + 320);
    const snippet = content.slice(startIndex, endIndex);
    const hasChineseLiteral = /['"`][\u4e00-\u9fff]{2,}[^'"`]*['"`]/.test(snippet);
    if (!hasChineseLiteral) continue;
    if (localizedWrapperPattern.test(snippet)) continue;
    if (localeBranchPattern.test(snippet)) continue;
    pushFinding(findings, file, getLineNumber(content, startIndex), 'Hardcoded Chinese toast/modal', snippet);
  }
}

function scanFile(file, findings) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (chineseIconPattern.test(line)) {
      pushFinding(findings, file, lineNumber, 'Chinese character icon', line);
    }

    if (firstCharPattern.test(line) && !isAvatarInitialAllowed(lines, lineNumber)) {
      pushFinding(findings, file, lineNumber, 'First-char icon fallback', line);
    }

    if (placeholderChinesePattern.test(line) && !localizedWrapperPattern.test(line)) {
      pushFinding(findings, file, lineNumber, 'Hardcoded Chinese placeholder', line);
    }

    if (
      templateChinesePattern.test(line) &&
      !line.includes('{{') &&
      !line.includes('food-mark') &&
      !line.includes('dish-mark')
    ) {
      pushFinding(findings, file, lineNumber, 'Hardcoded Chinese template text', line);
    }
  });

  scanToastAndModal(findings, file, content);
}

const files = walk(rootDir);
const findings = [];

for (const file of files) {
  scanFile(file, findings);
}

if (!findings.length) {
  console.log('check:i18n: no suspicious i18n issues found.');
  console.log('check:i18n: This is a review aid and does not block build.');
  process.exit(0);
}

console.log('check:i18n: review the following matches:');
for (const finding of findings) {
  console.log(`- ${finding.file}:${finding.line} [${finding.label}] ${finding.snippet}`);
}
console.log(`check:i18n: ${findings.length} match(es) found.`);
console.log('check:i18n: This is a review aid and does not block build.');
