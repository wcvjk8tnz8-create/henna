#!/usr/bin/env node
/** normalize-domains.mjs 自测：node scripts/test-normalize-domains.mjs */
import assert from 'node:assert/strict';
import { normalizeDomains } from './normalize-domains.mjs';

let pass = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
    pass++;
  } catch (e) {
    console.log('  ✗', name, '→', e.message);
    process.exitCode = 1;
  }
}
const ok = (raw, expected) => {
  const r = normalizeDomains(raw);
  assert.equal(r.ok, true, raw);
  assert.deepEqual(r.domains, expected);
  return r;
};

console.log('域名归一化：');
check('推荐写法：逗号串', () => ok('r0.us.ci,v-1.top', ['r0.us.ci', 'v-1.top']));
check('逗号 + 空格', () => ok('r0.us.ci, v-1.top', ['r0.us.ci', 'v-1.top']));
check('空白分隔', () => ok('r0.us.ci v-1.top', ['r0.us.ci', 'v-1.top']));
check('分号 / 顿号分隔', () => ok('r0.us.ci;v-1.top', ['r0.us.ci', 'v-1.top']));
check('顿号分隔', () => ok('r0.us.ci、v-1.top', ['r0.us.ci', 'v-1.top']));
check('单个域名', () => ok('r0.us.ci', ['r0.us.ci']));
check('旧 JSON 数组继续兼容', () => ok('["r0.us.ci","v-1.top"]', ['r0.us.ci', 'v-1.top']));
check('用户那次笔误（引号点错位）也能救', () => ok('["r0.us.ci","v-1".top]', ['r0.us.ci', 'v-1.top']));
check('无引号数组', () => ok('[r0.us.ci,v-1.top]', ['r0.us.ci', 'v-1.top']));
check('大写转小写', () => ok('R0.US.CI', ['r0.us.ci']));
check('去重', () => ok('r0.us.ci,r0.us.ci,v-1.top', ['r0.us.ci', 'v-1.top']));
check('通配域名', () => ok('*.r0.us.ci', ['*.r0.us.ci']));
check('带连字符的子域', () => ok('v-1.top', ['v-1.top']));
check('首尾空格与尾点', () => ok('  r0.us.ci.  ', ['r0.us.ci']));

check('输出是 JSON 数组字面量', () => {
  const r = ok('r0.us.ci,v-1.top', ['r0.us.ci', 'v-1.top']);
  assert.equal(r.json, '["r0.us.ci","v-1.top"]');
});
check('输出不含 sed 危险字符', () => {
  for (const v of ['r0.us.ci,v-1.top', '["a.com","b.net"]', '*.x.com']) {
    assert.equal(/[\\&|\n\r]/.test(normalizeDomains(v).json), false);
  }
});

console.log('\n拒绝非法输入：');
for (const [name, raw] of [
  ['空串', ''],
  ['空数组', '[]'],
  ['null', 'null'],
  ['只有分隔符', ',,,'],
  ['非法字符', 'r0.us.ci,ht!tp'],
  ['含斜杠', 'r0.us.ci/a.com'],
  ['sed 注入字符', 'a.com|rm -rf'],
  ['反斜杠', 'a.com\\b.net'],
]) {
  check(name + ' → 报错', () => {
    const r = normalizeDomains(raw);
    assert.equal(r.ok, false);
    assert.match(r.error, /请直接填域名/);
  });
}

console.log(`\n${pass} passed`);
