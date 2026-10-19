import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const cache = new Map();
function loadTS(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {};
  cache.set(url.href, exports);
  const code = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const require = id => {
    if (!id.startsWith('.')) return createRequire(url)(id);
    const target = ['.tsx', '.ts'].map(ext => new URL(id + ext, url)).find(path => fs.existsSync(path));
    if (!target) throw new Error(`Missing local module ${id}`);
    return loadTS(target);
  };
  vm.runInNewContext('(function(require, exports, React) {' + code + '\n})')(require, exports, React);
  return exports;
}
const { SkillInventory } = loadTS(new URL('../src/components/SkillInventory.tsx', import.meta.url));
const skill = { id: 'a', name: 'example', description: 'A real purpose', scope: 'project', role: 'specialist', path: '/skills/example', category: 'unknown' };
const props = { skills: [skill], managed: [], frequencies: new Map([['example', { explicit: 2, declared: 5, inferred: 9, lastEvidence: null }]]), variants: new Set(), ready: true, days: 30, onOpen() {}, onInspect() {} };
const render = extra => renderToStaticMarkup(React.createElement(SkillInventory, { ...props, ...extra }));
const list = render({ view: 'list' });
assert.match(list, /来源待核对/);
assert.doesNotMatch(list, /本地封装/);
assert.match(list, />2<\/strong>/);
assert.match(list, /5 \/ 9/);
assert.match(list, /配置 example/);
const cards = render({ view: 'cards' });
assert.match(cards, /近 30 天明确调用/);
assert.match(cards, />2<\/strong>/);
const unavailable = render({ view: 'list', ready: false });
assert.doesNotMatch(unavailable, />2<\/strong>/);
assert.match(unavailable, /—/);
assert.match(render({ view: 'list', variants: new Set(['example']) }), /同名合计/);
assert.match(list, /usage-frequency-low/);
assert.match(cards, /usage-frequency-low/);
assert.match(render({ view: 'list', frequencies: new Map([['example', { explicit: 13 }]]) }), /usage-frequency-high/);
assert.match(render({ view: 'list', frequencies: new Map([['example', { explicit: 0, declared: 50, inferred: 100 }]]) }), /暂无记录/);
assert.doesNotMatch(render({ view: 'list', frequencies: new Map([['example', { explicit: 0, declared: 50, inferred: 100 }]]) }), /usage-frequency-high/);
assert.match(render({ view: 'list', ready: false, availability: 'unavailable' }), /usage-frequency-unknown/);
assert.match(render({ view: 'list', ready: false, availability: 'unavailable' }), /异常/);
assert.doesNotMatch(render({ view: 'list', ready: false, availability: 'unmatched' }), /usage-frequency-error/);
assert.match(render({ view: 'list', ready: false, availability: 'unmatched' }), /未匹配/);
assert.doesNotMatch(unavailable, /usage-frequency-error/);
const { FrequencyLegend } = loadTS(new URL('../src/components/FrequencyBadge.tsx', import.meta.url));
const legend = renderToStaticMarkup(React.createElement(FrequencyLegend, { days: 30 }));
assert.match(legend, /usage-frequency-high[^>]*>红 · 高频/);
assert.match(legend, /usage-frequency-medium[^>]*>黄 · 中频/);
assert.match(legend, /usage-frequency-low[^>]*>绿 · 低频/);
assert.doesNotMatch(legend, /采集异常/);
assert.match(render({ view: 'cards', frequencies: new Map([['example', { explicit: 5 }]]) }), /中频/);
console.log('25 inventory rendering checks passed');

const { specKitFamily } = loadTS(new URL('../src/lib/skillFamily.ts', import.meta.url));
const specCopies = [
  { ...skill, id: 'plan-a', name: 'speckit-plan', project_id: 'a', path: '/a/plan' },
  { ...skill, id: 'plan-b', name: 'speckit-plan', project_id: 'b', path: '/b/plan' },
  { ...skill, id: 'tasks-a', name: 'speckit-tasks', project_id: 'a', path: '/a/tasks' },
];
const specFrequencies = new Map([
  ['speckit-plan', { explicit: 4, declared: 2, inferred: 3, lastEvidence: 10 }],
  ['speckit-tasks', { explicit: 6, declared: 1, inferred: 1, lastEvidence: 20 }],
]);
const family = specKitFamily([...specCopies, skill], specFrequencies);
assert.equal(family.copies, 3);
assert.equal(family.projects, 2);
assert.equal(family.stages.size, 2);
assert.equal(family.total.explicit, 10, 'project copies must not multiply name-based frequency');
assert.equal(family.total.declared, 3);
assert.equal(family.total.inferred, 4);
assert.equal(family.total.lastEvidence, 20);
assert.equal(family.other.length, 1);
assert.equal(family.other[0].id, skill.id);
assert.equal(family.stages.get('speckit-plan')[1].path, '/b/plan');
assert.equal(specKitFamily([skill], new Map()).copies, 0);
assert.equal(specKitFamily([{ ...skill, name: 'speckitish' }], new Map()).copies, 0);
assert.equal(specKitFamily([specCopies[0]], specFrequencies).total.explicit, 4);
const familyMarkup = render({ view: 'cards', skills: [...specCopies, skill], frequencies: specFrequencies });
assert.equal((familyMarkup.match(/aria-label="SpecKit 技能组"/g) || []).length, 1);
assert.match(familyMarkup, /2 个阶段 · 2 个项目 · 3 个副本/);
assert.match(familyMarkup, /^<div class="grid grid-cols-2 xl:grid-cols-3 gap-3"><article aria-label="SpecKit 技能组" class="app-panel p-3 flex flex-col gap-2">/);
assert.doesNotMatch(familyMarkup, /<details|<summary/, 'SpecKit is a normal summary card, not an accordion');
assert.doesNotMatch(familyMarkup, /配置 speckit-|查看 speckit-/, 'display-only family cannot act on an arbitrary copy');
assert.match(familyMarkup, /配置 example/);
assert.match(familyMarkup, /按阶段名称合计/);
const groupedList = render({ view: 'list', skills: specCopies, frequencies: specFrequencies });
assert.match(groupedList, /<tbody><tr aria-label="SpecKit 技能组"/);
assert.match(groupedList, /仅展示/);
assert.match(render({ view: 'cards', skills: specCopies, ready: false }), /待统计/);
assert.equal(family.stages.get('speckit-plan')[1].id, 'plan-b');
assert.equal(specCopies.length, 3, 'grouping cannot mutate the discovered inventory');
console.log('SpecKit card layout and evidence aggregation checks passed');
