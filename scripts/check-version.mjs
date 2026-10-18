import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedPackages = [
  ['figma-sync/package.json', 'figma-sync'],
  ['cocos-sync/package.json', 'cocos-sync'],
];
const expectedLocks = [
  ['figma-sync/package-lock.json', 'figma-sync'],
  ['cocos-sync/package-lock.json', 'cocos-sync'],
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

const version = (await readFile(resolve(root, 'VERSION'), 'utf8')).trim();
if (!/^\d{1,2}\.\d{1,2}\.\d+$/.test(version)) {
  throw new Error(`VERSION 不是 YY.WW.MICRO：${version}`);
}

const errors = [];
for (const [relativePath, expectedName] of expectedPackages) {
  const value = await readJson(relativePath);
  if (value.name !== expectedName) errors.push(`${relativePath} name=${value.name ?? '<missing>'}`);
  if (value.version !== version) errors.push(`${relativePath} version=${value.version ?? '<missing>'}`);
}
const sandbox = await readJson('sandbox/package.json');
if (sandbox.name !== 'doomui-sandbox') errors.push(`sandbox/package.json name=${sandbox.name ?? '<missing>'}`);
if (sandbox.version !== '3.8.6') errors.push(`sandbox/package.json version=${sandbox.version ?? '<missing>'}`);
if (sandbox.creator?.version !== '3.8.6') errors.push(`sandbox/package.json creator.version=${sandbox.creator?.version ?? '<missing>'}`);
for (const [relativePath, expectedName] of expectedLocks) {
  const value = await readJson(relativePath);
  if (value.name !== expectedName) errors.push(`${relativePath} name=${value.name ?? '<missing>'}`);
  if (value.version !== version) errors.push(`${relativePath} version=${value.version ?? '<missing>'}`);
  if (value.packages?.['']?.name !== expectedName) errors.push(`${relativePath} packages[""] name=${value.packages?.['']?.name ?? '<missing>'}`);
  if (value.packages?.['']?.version !== version) errors.push(`${relativePath} packages[""] version=${value.packages?.['']?.version ?? '<missing>'}`);
}

let headTags = [];
try {
  headTags = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean);
} catch {
  if (process.argv.includes('--require-tag')) errors.push('无法读取 HEAD Tag');
}
const calverTags = headTags.filter((tag) => /^\d{1,2}\.\d{1,2}\.\d+$/.test(tag));
if (calverTags.some((tag) => tag !== version)) {
  errors.push(`HEAD 上存在不同版本的 CalVer Tag：${calverTags.join(', ')}`);
}
if (process.argv.includes('--require-tag') && !headTags.includes(version)) {
  errors.push(`HEAD 缺少 Tag ${version}`);
}

if (errors.length) {
  process.stderr.write(`版本校验失败：\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(`版本校验通过：${version}${headTags.includes(version) ? '（Tag 已同步）' : ''}\n`);
