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
const props = { skills: [skill], managed: [], frequencies: new Map([['example', { explicit: 2, declared: 5, inferred: 9, lastEvidence: null }]]), variants: new Set(), ready: true, days: 30, onOpen() {}, onInspect() {}, onViewFamily() {}, onUninstall() {} };
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


const { groupSkillFamilies } = loadTS(new URL('../src/lib/skillFamily.ts', import.meta.url));
const { SkillFamilyCard } = loadTS(new URL('../src/components/SkillFamilyCard.tsx', import.meta.url));
const specCopies = [
  { ...skill, id: 'plan-a', name: 'speckit-plan', project_id: 'a', path: '/a/plan' },
  { ...skill, id: 'plan-b', name: 'speckit-plan', project_id: 'b', path: '/b/plan' },
  { ...skill, id: 'tasks-a', name: 'speckit-tasks', project_id: 'a', path: '/a/tasks' },
];
const specFrequencies = new Map([
  ['speckit-plan', { explicit: 4, declared: 2, inferred: 3, lastEvidence: 10 }],
  ['speckit-tasks', { explicit: 6, declared: 1, inferred: 1, lastEvidence: 20 }],
]);
const entries = groupSkillFamilies([...specCopies, skill], specFrequencies);
const family = entries[0].family;
assert.equal(family.copies, 3);
assert.equal(family.projects, 2);
assert.equal(family.stages.size, 2);
assert.equal(family.total.explicit, 10);
assert.equal(family.total.declared, 3);
assert.equal(family.total.inferred, 4);
assert.equal(family.total.lastEvidence, 20);
assert.equal(entries[1].skill.id, skill.id);
assert.equal(family.stages.get('speckit-plan')[1].id, 'plan-b');
assert.equal(groupSkillFamilies([skill], new Map())[0].kind, 'skill');
assert.equal(groupSkillFamilies([{ ...skill, name: 'speckitish' }], new Map())[0].kind, 'skill');
assert.equal(groupSkillFamilies([specCopies[0]], specFrequencies)[0].family.total.explicit, 4);
const familyMarkup = render({ view: 'cards', skills: [...specCopies, skill], frequencies: specFrequencies });
assert.equal((familyMarkup.match(/aria-label="SpecKit 技能组"/g) || []).length, 1);
assert.match(familyMarkup, /2 个阶段 · 2 个项目 · 3 个副本/);
assert.match(familyMarkup, /^<div class="grid grid-cols-2 xl:grid-cols-3 gap-3"><article aria-label="SpecKit 技能组" class="app-panel p-3 flex flex-col gap-2">/);
assert.doesNotMatch(familyMarkup, /<details|<summary/);
assert.match(familyMarkup, /aria-label="查看 SpecKit 技能组"/);
assert.match(familyMarkup, /配置 example/);
assert.match(familyMarkup, /按技能名称合计/);
assert.match(render({ view: 'list', skills: specCopies, frequencies: specFrequencies }), /<tbody><tr aria-label="SpecKit 技能组"/);
assert.match(render({ view: 'cards', skills: specCopies, ready: false }), /待统计/);
const openspec = ['openspec-apply-change', 'openspec-apply-change', 'openspec-propose', 'source-command-opsx-apply'].map((name, i) => ({ ...skill, name, id: `open-${i}`, project_id: String(i), path: `/open/${i}` }));
const openEntries = groupSkillFamilies(openspec, new Map([['openspec-apply-change', { explicit: 5 }], ['openspec-propose', { explicit: 2 }]]));
assert.equal(openEntries.length, 1);
assert.equal(openEntries[0].family.title, 'OpenSpec');
assert.equal(openEntries[0].family.total.explicit, 7);
assert.equal(openEntries[0].family.copies, 4);
assert.match(render({ view: 'cards', skills: openspec }), /查看 OpenSpec 技能组/);
const duplicate = [{ ...skill, id: 'one', name: 'same' }, { ...skill, id: 'two', name: 'same', path: '/other/same' }];
const grouped = groupSkillFamilies([skill, ...duplicate], new Map());
assert.equal(grouped[0].kind, 'skill');
assert.equal(grouped[1].family.title, 'same');
assert.equal(grouped[1].family.stages.get('same')[1].id, 'two');
let opened;
const tree = SkillFamilyCard({ family: openEntries[0].family, onView(value) { opened = value; }, days: 30, state: 'ready', view: 'cards' });
function nodes(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
nodes(tree).find(n => n.props?.['aria-label'] === '查看 OpenSpec 技能组').props.onClick();
assert.equal(opened.id, 'suite:openspec');
assert.equal(opened.stages.get('openspec-apply-change')[1].id, 'open-1');
assert.equal(specCopies.length, 3);
console.log('Family grouping, view buttons and evidence aggregation checks passed');

const baoyuCopies = ['baoyu-cover-image', 'baoyu-comic', 'baoyu-cover-image', 'baoyu-image-gen', 'baoyu-imagine'].map((name, i) => ({ ...skill, name, id: `baoyu-${i}`, path: `/baoyu/${i}` }));
const baoyu = groupSkillFamilies([...baoyuCopies, skill, { ...skill, id: 'unrelated', name: 'baoyushi' }], new Map([['baoyu-cover-image', { explicit: 3, declared: 1, inferred: 2 }], ['baoyu-comic', { explicit: 2 }]]));
assert.equal(baoyu.length, 3);
assert.equal(baoyu[0].family.title, 'Baoyu 系列');
assert.equal(baoyu[0].family.stages.size, 4);
assert.equal(baoyu[0].family.copies, 5);
assert.equal(baoyu[0].family.total.explicit, 5, 'Repeated copies do not multiply calls');
assert.equal(baoyu[0].family.stages.get('baoyu-image-gen')[0].id, 'baoyu-3', 'Historical and replacement skill identities remain separate');
assert.equal(baoyu[1].skill.id, skill.id);
assert.equal(baoyu[2].kind, 'skill', 'Only the baoyu- prefix belongs to this collection');
const baoyuMarkup = render({ view: 'cards', skills: baoyuCopies });
assert.match(baoyuMarkup, /查看 Baoyu 系列 技能组/);
assert.match(baoyuMarkup, /4 种技能 · 5 个副本/);
assert.equal((baoyuMarkup.match(/<article /g) || []).length, 1);
assert.match(render({ view: 'list', skills: baoyuCopies }), /查看 Baoyu 系列 技能组/);
assert.equal(groupSkillFamilies([baoyuCopies[0]], new Map())[0].family.title, 'Baoyu 系列');
console.log('Baoyu collection grouping, distinct legacy skills, one-card rendering and unmultiplied usage checks passed');

assert.match(render({ view: 'cards', managed: [{ id: skill.id, targets: [] }] }), /aria-label="卸载 example"/);
assert.match(render({ view: 'list', managed: [{ id: skill.id, targets: [] }] }), /aria-label="卸载 example"/);
assert.match(baoyuMarkup, /选择卸载 Baoyu 系列 中的技能/);
let uninstallTarget;
const inventoryTree = SkillInventory({ ...props, view: 'cards', managed: [{ id: skill.id, targets: [] }], onUninstall(value) { uninstallTarget = value; } });
nodes(inventoryTree).find(n => n.props?.['aria-label'] === '卸载 example').props.onClick();
assert.equal(uninstallTarget.id, skill.id);
const unmanagedGlobal = SkillInventory({ ...props, view: 'cards', skills: [{ ...skill, scope: 'global' }] });
assert.equal(nodes(unmanagedGlobal).find(n => n.props?.['aria-label'] === '卸载 example').props.disabled, true);
console.log('Visible card/list uninstall buttons, exact ID routing and unmanaged global protection checks passed');

assert.doesNotMatch(render({ view: 'cards', managed: [{ id: skill.id, targets: [] }] }), />卸载<\/button>/);
assert.doesNotMatch(baoyuMarkup, />选择卸载<\/button>/);
assert.match(baoyuMarkup, /title="选择具体技能卸载"/);
assert.match(baoyuMarkup, /lucide-trash/);
console.log('Uninstall uses icon-only buttons while retaining tooltip and accessible labels.');
