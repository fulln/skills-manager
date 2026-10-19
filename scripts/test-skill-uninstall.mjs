import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync('src/components/SkillUninstallDialog.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
function setup(managed, fail = false, refreshFail = false) {
  const calls = [], exports = {};
  let removed = 0, closed = 0;
  const require = id => {
    if (id === 'react-dom') return { createPortal: node => node };
    if (id === 'sonner') return { toast: { success: text => calls.push(['success', text]), error: text => calls.push(['error', text]), warning: text => calls.push(['warning', text]) } };
    if (id === './ConfirmDialog') return { ConfirmDialog: 'confirm-dialog' };
    if (id === '../context/AppContext') return { useApp: () => ({ refreshAppData: async () => { calls.push(['refresh']); if (refreshFail) throw Error('refresh failed'); } }) };
    if (id === '../lib/tauri') return { deleteManagedSkill: async id => { calls.push(['managed', id]); if (fail) throw Error('delete failed'); } };
    if (id === '@tauri-apps/api/core') return { invoke: async (command, args) => { calls.push(['project', command, args]); if (fail) throw Error('delete failed'); } };
    if (id === '../lib/error') return { getErrorMessage: e => e.message };
    throw Error(id);
  };
  vm.runInNewContext('(function(require,exports,React,document){' + code + '\n})')(require, exports, React, { body: {} });
  const target = { id: 'chosen-id', name: 'same-name', path: '/project-b/.agents/skills/same-name', managed };
  const dialog = exports.SkillUninstallDialog({ target, onClose() { closed++; }, onRemoved(value) { assert.equal(value, target); removed++; } });
  return { dialog, target, calls, removed: () => removed, closed: () => closed };
}
const m = setup(true);
assert.equal(m.calls.length, 0, 'Opening confirmation must never delete');
assert.equal(m.dialog.props.lockWhileRunning, true);
assert.match(m.dialog.props.message, /共享技能库/);
m.dialog.props.onClose(); assert.equal(m.calls.length, 0, 'Cancel never deletes');
await m.dialog.props.onConfirm();
assert.equal(m.calls[0][0], 'managed'); assert.equal(m.calls[0][1], 'chosen-id');
assert.equal(m.removed(), 1); assert(m.calls.some(c => c[0] === 'refresh'));
const p = setup(false);
assert.match(p.dialog.props.message, /当前项目技能目录/);
assert.equal(p.dialog.props.details[0], p.target.path);
await p.dialog.props.onConfirm();
assert.equal(p.calls[0][1], 'workflow_uninstall_project');
assert.equal(p.calls[0][2].skillId, 'chosen-id');
assert.equal(p.calls[0][2].expectedPath, p.target.path);
const failure = setup(false, true); assert.equal(await failure.dialog.props.onConfirm(), false, 'Failed deletion keeps confirmation open');
assert.equal(failure.removed(), 0); assert(!failure.calls.some(c => c[0] === 'refresh' || c[0] === 'success'));
assert(failure.calls.some(c => c[0] === 'error'));
const refreshFailure = setup(true, false, true); await refreshFailure.dialog.props.onConfirm();
assert.equal(refreshFailure.removed(), 1); assert(refreshFailure.calls.some(c => c[0] === 'warning'));
console.log('Uninstall confirmation cancellation, exact managed/project routing, failure preservation and refresh checks passed.');

const confirmCode = ts.transpileModule(fs.readFileSync('src/components/ConfirmDialog.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
async function confirmCloses(result) {
  let closes = 0;
  const exports = {};
  const require = id => {
    if (id === 'react') return { useState: value => [value, () => {}], useEffect() {} };
    if (id === 'lucide-react') return { X: 'x-icon', AlertTriangle: 'alert-icon' };
    if (id === 'react-i18next') return { useTranslation: () => ({ t: x => x }) };
    throw Error(id);
  };
  vm.runInNewContext('(function(require,exports,React){' + confirmCode + '\n})')(require, exports, React);
  const tree = exports.ConfirmDialog({ open: true, message: 'chosen path', onConfirm: async () => result, onClose: () => closes++ });
  function nodes(n) { return !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)]; }
  const buttons = nodes(tree).filter(n => n.type === 'button');
  await buttons[buttons.length - 1].props.onClick();
  return closes;
}
assert.equal(await confirmCloses(false), 0, 'Explicit failure retains dialog for retry');
assert.equal(await confirmCloses(true), 1);
assert.equal(await confirmCloses(undefined), 1, 'Existing void callbacks retain prior behavior');
console.log('Confirmation stays open after failure and preserves existing callers.');
