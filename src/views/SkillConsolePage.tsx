import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SkillConsole } from '../components/SkillConsole';
import { DetailSheet } from '../components/DetailSheet';
import { SkillMarkdown } from '../components/SkillMarkdown';
import { useApp } from '../context/AppContext';
import { getSkillDocument, type SkillDocument } from '../lib/tauri';
import { workflowSnapshot, type WorkflowSkill } from '../lib/workflow';
import type { LiveUsageEvent } from '../lib/liveUsage';
import { consoleSkillCandidates } from '../lib/consoleSkill';

export function SkillConsolePage() {
  const navigate = useNavigate();
  const { managedSkills, openSkillDetailById } = useApp();
  const [choices, setChoices] = useState<WorkflowSkill[]>([]);
  const [reading, setReading] = useState<WorkflowSkill | null>(null);
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { ++sequence.current; }, []);
  const close = useCallback(() => { ++sequence.current; setReading(null); setChoices([]); setBusy(false); setError(''); }, []);
  async function show(skill: WorkflowSkill) {
    const request = ++sequence.current; setChoices([]); setError('');
    if (managedSkills.some(managed => managed.id === skill.id)) {
      openSkillDetailById(skill.id);
      navigate('/my-skills', { state: { from: '/skill-console' } });
      return;
    }
    setReading(skill); setDocument(null); setBusy(true);
    try {
      const next = await getSkillDocument(skill.id);
      if (request === sequence.current) setDocument(next);
    } catch (e) { if (request === sequence.current) setError(String(e)); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  async function open(event: LiveUsageEvent) {
    const request = ++sequence.current; setError(''); setBusy(true);
    try {
      const snapshot = await workflowSnapshot();
      if (request !== sequence.current) return;
      const candidates = consoleSkillCandidates(event, snapshot);
      setBusy(false);
      if (candidates.length === 1) void show(candidates[0]);
      else if (candidates.length > 1) setChoices(candidates);
      else setError('当前清单中未找到该技能，可能已移除。请刷新技能清单后重试。');
    } catch (e) { if (request === sequence.current) { setError(String(e)); setBusy(false); } }
  }
  return <div className="app-page gap-4">
    <header><h1 className="app-page-title">技能控制台</h1><p className="mt-1 text-[12px] text-secondary">查看 AI、项目与技能关系，点击 Skill 打开介绍。</p></header>
    {busy && !reading && <p role="status" className="text-[12px] text-secondary">正在定位技能…</p>}
    {error && !reading && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <SkillConsole onOpenSkill={event => void open(event)} />
    <DetailSheet open={choices.length > 0} title="选择技能副本" description="同名技能存在多个目录，请选择要查看的版本。" onClose={close}>
      <div className="space-y-2">{choices.map(skill => <button key={skill.id} className="app-panel block w-full p-3 text-left" onClick={() => void show(skill)}><strong className="text-[13px]">{skill.name}</strong><p className="mt-1 break-all text-[12px] text-secondary">{skill.path}</p></button>)}</div>
    </DetailSheet>
    <DetailSheet open={!!reading} title={reading?.name || ''} description={reading?.description} meta={<p className="break-all text-[12px] text-tertiary">项目 / 本地技能 · {document?.central_path || reading?.path}</p>} onClose={close}>
      {busy ? <p className="text-[13px] text-secondary">正在读取技能说明…</p> : error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : document ? <SkillMarkdown content={document.content} /> : null}
    </DetailSheet>
  </div>;
}
