#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const isProduction =
  args.has('--production') ||
  process.env.APP_ENV === 'production' ||
  process.env.NODE_ENV === 'production';

const filesToScan = [
  '.env',
  '.env.local',
  'app.json',
  'src/lib/env.ts',
].map((relativePath) => path.join(projectRoot, relativePath));

const localUrlPattern =
  /(?:EXPO_PUBLIC_API_BASE_URL|EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE)\s*[:=]\s*["']?(http:\/\/[^"'\\s]+|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168(?:\.\d{1,3}){2})[^"'\\s]*)/i;

if (!isProduction) {
  console.log('[check-release-env] skipped: non-production mode');
  process.exit(0);
}

const violations = [];

for (const filePath of filesToScan) {
  if (!fs.existsSync(filePath)) continue;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/(EXPO_PUBLIC_API_BASE_URL|EXPO_PUBLIC_ECHOLINGO_WEB_API_BASE)/.test(line)) return;
    const match = line.match(localUrlPattern);
    if (!match) return;
    violations.push({
      file: path.relative(projectRoot, filePath),
      line: index + 1,
      value: match[1],
    });
  });
}

if (violations.length > 0) {
  console.error('[check-release-env] production build blocked: local API base detected');
  violations.forEach((entry) => {
    console.error(`- ${entry.file}:${entry.line} -> ${entry.value}`);
  });
  process.exit(1);
}

console.log('[check-release-env] passed: no local API base found for production');
