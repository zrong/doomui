import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2]?.trim();
if (!version || !/^\d{1,2}\.\d{1,2}\.\d+$/.test(version)) {
  process.stderr.write('Usage: node scripts/set-version.mjs <YY.WW.MICRO>\n');
  process.exit(1);
}

const packageFiles = [
  'figma-sync/package.json',
  'cocos-sync/package.json',
];
const lockFiles = [
  'figma-sync/package-lock.json',
  'cocos-sync/package-lock.json',
];

async function updateJson(relativePath, update) {
  const path = resolve(root, relativePath);
  const value = JSON.parse(await readFile(path, 'utf8'));
  update(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

for (const relativePath of packageFiles) {
  await updateJson(relativePath, (value) => { value.version = version; });
}
for (const relativePath of lockFiles) {
  await updateJson(relativePath, (value) => {
    value.version = version;
    if (value.packages?.['']) value.packages[''].version = version;
  });
}
await writeFile(resolve(root, 'VERSION'), `${version}\n`);
process.stdout.write(`已将项目版本更新为 ${version}\n`);
