import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import ts from 'typescript';

const url = new URL('../src/components/SkillFamilyDetail.tsx', import.meta.url);
const compiled = ts.transpileModule(fs.readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
function harness(managedIds = new Set()) {
  const values = [], effects = [], requests = [];
  let index = 0, managed;
  const hooks = {
    useState(initial) {
      const key = index++;
      if (!(key in values)) values[key] = initial;
      return [values[key], next => { values[key] = typeof next === 'function' ? next(values[key]) : next; }];
    },
    useRef(initial) {
      const key = index++;
      if (!(key in values)) values[key] = { current: initial };
      return values[key];
    },
    useMemo(fn) { return fn(); },
    useEffect(fn) {
      const key = index++;
      if (!(key in values)) { values[key] = true; effects.push(fn()); }
    },
  };
  const exports = {};
  const require = id => {
    if (id === 'react') return hooks;
    if (id === './DetailSheet') return { DetailSheet: 'detail-sheet' };
    if (id === './SkillMarkdown') return { SkillMarkdown: 'skill-markdown' };
    if (id === '../lib/tauri') return { getSkillDocument(skillId) {
      return new Promise((resolve, reject) => requests.push({ skillId, resolve, reject }));
    } };
    throw new Error(`Unexpected dependency ${id}`);
  };
  vm.runInNewContext('(function(require,exports,React){' + compiled + '\n})')(require, exports, React);
  const a = { id: 'a', name: 'openspec-apply', path: '/project-a/skill', project_id: 'pa' };
  const b = { id: 'b', name: 'openspec-apply', path: '/project-b/skill', project_id: 'pb' };
  const c = { id: 'c', name: 'openspec-propose', path: '/project-a/propose', project_id: 'pa' };
  const family = { id: 'suite:openspec', title: 'OpenSpec', description: 'A real suite', stages: new Map([['openspec-apply', [a, b]], ['openspec-propose', [c]]]) };
  const render = () => { index = 0; return exports.SkillFamilyDetail({ family, projects: [{ id: 'pa', name: 'Project A' }, { id: 'pb', name: 'Project B' }], managedIds, onOpenManaged(id) { managed = id; }, onClose() {} }); };
  return { render, requests, unmount() { effects.forEach(fn => fn?.()); }, managed: () => managed };
}
function nodes(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value, ...nodes(value.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, text) => find(tree, n => n.type === 'button' && nodes(n).some(x => x.type === 'strong' && String(x.props.children).includes(text)));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

const h = harness();
let tree = h.render();
assert(button(tree, 'Project A')); assert(button(tree, 'Project B'));
const project = find(tree, n => n.props?.['aria-label'] === '所属项目');
project.props.onChange({ target: { value: 'pb' } });
tree = h.render();
assert(!button(tree, 'Project A')); assert(button(tree, 'Project B'));
find(tree, n => n.props?.['aria-label'] === '技能阶段').props.onChange({ target: { value: 'openspec-propose' } });
tree = h.render();
assert.equal(find(tree, n => n.props?.['aria-label'] === '所属项目').props.value, '');
assert(button(tree, 'openspec-propose'));
find(tree, n => n.props?.['aria-label'] === '技能阶段').props.onChange({ target: { value: 'openspec-apply' } });
button(h.render(), 'Project B').props.onClick();
assert.equal(h.requests[0].skillId, 'b');
h.requests[0].resolve({ content: '# Project B actual document', central_path: '/project-b/skill' }); await flush();
tree = h.render();
assert.equal(find(tree, n => n.type === 'skill-markdown').props.content, '# Project B actual document');
find(tree, n => n.type === 'button' && String(n.props.children).includes('返回技能组')).props.onClick();
button(h.render(), 'Project A').props.onClick();
tree = h.render();
find(tree, n => n.type === 'button' && String(n.props.children).includes('返回技能组')).props.onClick();
button(h.render(), 'Project B').props.onClick();
h.requests[2].resolve({ content: 'new B' }); await flush();
h.requests[1].resolve({ content: 'stale A' }); await flush();
assert.equal(find(h.render(), n => n.type === 'skill-markdown').props.content, 'new B');
const m = harness(new Set(['b'])); button(m.render(), 'Project B').props.onClick();
assert.equal(m.managed(), 'b'); assert.equal(m.requests.length, 0);
const failed = harness(); button(failed.render(), 'Project A').props.onClick();
failed.requests[0].reject(new Error('missing document')); await flush();
assert.match(String(find(failed.render(), n => n.props?.role === 'alert').props.children), /missing document/);
const gone = harness(); button(gone.render(), 'Project A').props.onClick(); gone.unmount();
gone.requests[0].resolve({ content: 'late after unmount' }); await flush();
assert(!find(gone.render(), n => n.type === 'skill-markdown'));
console.log('Family stage/project selection, exact document ID, stale request, managed handoff and error checks passed');
