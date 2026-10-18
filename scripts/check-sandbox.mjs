import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../sandbox/assets');
// Creator 3.8.6 supplies these images; the fixture does not copy engine assets.
const internalSpriteFrames = new Set([
  '20835ba4-6145-4fbc-a58a-051ce700aa3e@f9941',
  'b730527c-3233-41c2-aaf7-7cdab58f9749@f9941',
]);
const assets = new Map();
const scripts = new Set();
const documents = [];

function scriptType(uuid) {
  const hex = uuid.replaceAll('-', '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = hex.slice(0, 5);
  for (let i = 5; i < hex.length; i += 3) {
    const value = Number.parseInt(hex.slice(i, i + 3), 16);
    result += alphabet[value >> 6] + alphabet[value & 63];
  }
  return result;
}

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), `示例资产不能是本机软链接：${path}`);
    if (entry.name.endsWith('.meta')) continue;
    const meta = JSON.parse(await readFile(`${path}.meta`, 'utf8'));
    assert(meta.uuid, `资产缺少 UUID：${path}`);
    assert(!assets.has(meta.uuid), `重复 UUID：${path} / ${assets.get(meta.uuid)}`);
    assets.set(meta.uuid, path);
    if (entry.isDirectory()) {
      await visit(path);
      continue;
    }
    const content = await readFile(path, 'utf8');
    assert(!/(?:\/Users\/|[A-Z]:\\Users\\|\/home\/)/.test(content), `示例含本机路径：${path}`);
    if (entry.name.endsWith('.ts')) scripts.add(scriptType(meta.uuid));
    if (/\.(prefab|scene)$/.test(entry.name)) {
      const objects = JSON.parse(content);
      assert(Array.isArray(objects), `场景或 Prefab 格式错误：${path}`);
      documents.push({ path, objects });
    }
  }
}

function check(value, objects, path) {
  if (Array.isArray(value)) {
    value.forEach((item) => check(item, objects, path));
  } else if (value && typeof value === 'object') {
    if ('__id__' in value) {
      assert(Number.isInteger(value.__id__) && value.__id__ >= 0 && value.__id__ < objects.length,
        `序列化对象引用越界：${path} #${value.__id__}`);
    }
    if ('__uuid__' in value) {
      assert(assets.has(value.__uuid__) || internalSpriteFrames.has(value.__uuid__),
        `未随示例提交的资源引用：${path} ${value.__uuid__}`);
    }
    if ('__type__' in value && !value.__type__.startsWith('cc.') && !value.__type__.startsWith('CC')) {
      assert(scripts.has(value.__type__), `缺少脚本资产：${path} ${value.__type__}`);
    }
    Object.values(value).forEach((item) => check(item, objects, path));
  }
}

await visit(root);
for (const { path, objects } of documents) check(objects, objects, relative(root, path));
assert(documents.some(({ path }) => path.endsWith('/ArticleDemo.scene')), '缺少可运行示例场景');
process.stdout.write(`Sandbox 资产校验通过：${assets.size} 项资产，${documents.length} 个场景/Prefab，项目 UUID、脚本与内置 SpriteFrame 引用均可解析。\n`);
