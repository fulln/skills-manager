import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DetailSheet } from './DetailSheet';
import { SkillMarkdown } from './SkillMarkdown';
import { getSkillDocument, type SkillDocument } from '../lib/tauri';
import type { SkillFamily } from '../lib/skillFamily';
import type { WorkflowProject, WorkflowSkill } from '../lib/workflow';

interface Props {
  family: SkillFamily;
  projects: WorkflowProject[];
  onClose: () => void;
  managedIds: Set<string>;
  onOpenManaged: (id: string) => void;
  onUninstall: (skill: WorkflowSkill) => void;
}

type Reading = { skill: WorkflowSkill; projectName: string };

export function SkillFamilyDetail({ family, projects, onClose, managedIds, onOpenManaged, onUninstall }: Props) {
  const selectorLabel = family.id === 'collection:baoyu' ? '系列技能' : '技能阶段';
  const stages = useMemo(() => [...family.stages.entries()], [family.stages]);
  const [stage, setStage] = useState(stages[0]?.[0] || '');
  const [projectId, setProjectId] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  useEffect(() => () => { ++sequence.current; }, []);

  const selectedStage = family.stages.has(stage) ? stage : stages[0]?.[0] || '';
  const stageCopies = family.stages.get(selectedStage) || [];
  const selectedProjectId = stageCopies.some(skill => skill.project_id === projectId) ? projectId : '';
  const copies = stageCopies.filter(skill => !selectedProjectId || skill.project_id === selectedProjectId);
  const activeReading = reading && [...family.stages.values()].some(skills => skills.some(skill => skill.id === reading.skill.id)) ? reading : null;

  const projectName = (id: string | null) =>
    id ? projects.find((project) => project.id === id)?.name || id : '本地';

  function back() {
    ++sequence.current;
    setReading(null);
    setDocument(null);
    setBusy(false);
    setError('');
  }

  async function show(skill: WorkflowSkill) {
    if (managedIds.has(skill.id)) {
      onOpenManaged(skill.id);
      return;
    }
    const request = ++sequence.current;
    setReading({ skill, projectName: projectName(skill.project_id) });
    setDocument(null);
    setError('');
    setBusy(true);
    try {
      const next = await getSkillDocument(skill.id);
      if (request === sequence.current) setDocument(next);
    } catch (e) {
      if (request === sequence.current) setError(String(e));
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }

  function uninstallButton(skill: WorkflowSkill) {
    const allowed = managedIds.has(skill.id) || (skill.scope === 'project' && !!skill.project_id);
    return <button type="button" aria-label={`卸载 ${skill.name} · ${projectName(skill.project_id)}`} title={allowed ? '卸载此副本' : '由原插件或 Agent 管理，请在原管理器卸载'} disabled={!allowed} className="app-icon-button shrink-0 hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onUninstall(skill)}><Trash2 size={15} /></button>;
  }

  return (
    <DetailSheet open title={family.title} description={activeReading ? undefined : family.description} onClose={onClose}>
      {activeReading ? (
        <div>
          <button type="button" className="mb-4 text-[12px] text-accent-light hover:underline" onClick={back}>
            ← 返回技能组
          </button>
          <div className="flex items-center justify-between gap-3"><h3 className="text-[17px] font-semibold text-primary">{activeReading.skill.name}</h3>{uninstallButton(activeReading.skill)}</div>
          <p className="mt-1 break-all text-[12px] text-tertiary">{document?.central_path || activeReading.skill.path}</p>
          <div className="mt-5">
            {busy ? <p className="text-[13px] text-secondary">正在读取技能说明…</p> : error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : document ? <SkillMarkdown content={document.content} /> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-[12px] text-secondary">
              {selectorLabel}
              <select aria-label={selectorLabel} className="app-input h-8" value={selectedStage} onChange={(event) => { setStage(event.target.value); setProjectId(''); }}>
                {stages.map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[12px] text-secondary">
              所属项目
              <select aria-label="所属项目" className="app-input h-8" value={selectedProjectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">全部项目</option>
                {projects.filter((project) => (family.stages.get(selectedStage) || []).some((skill) => skill.project_id === project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          </div>
          <div className="space-y-2">
            {copies.map((skill) => <div key={skill.id} className="app-panel flex items-center gap-3 p-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => void show(skill)}><strong className="text-[13px]">查看 {skill.name} · {projectName(skill.project_id)}</strong><p className="mt-1 break-all text-[12px] text-secondary">{skill.path}</p></button>{uninstallButton(skill)}</div>)}
            {!copies.length && <p className="text-[12px] text-secondary">当前筛选没有技能副本。</p>}
          </div>
        </div>
      )}
    </DetailSheet>
  );
}
