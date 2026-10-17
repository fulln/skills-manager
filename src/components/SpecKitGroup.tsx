import { FileSearch, SlidersHorizontal } from 'lucide-react';
import { FrequencyBadge } from './FrequencyBadge';
import { specKitFamily } from '../lib/skillFamily';
import type { WorkflowProject, WorkflowSkill } from '../lib/workflow';

interface Props {
  family: ReturnType<typeof specKitFamily>;
  projects: WorkflowProject[];
  frequencies: Parameters<typeof specKitFamily>[1];
  managedIds: Set<string>;
  days: number;
  state: 'ready' | 'loading' | 'unavailable' | 'unmatched';
  onInspect: (skill: WorkflowSkill) => void;
  onOpen: (id: string) => void;
}

export function SpecKitGroup({ family, projects, frequencies, managedIds, days, state, onInspect, onOpen }: Props) {
  const projectsById = new Map(projects.map(p => [p.id, p]));
  return <details className="app-panel overflow-hidden" aria-label="SpecKit 技能组">
    <summary className="cursor-pointer p-4">
      <span className="inline-flex flex-wrap items-center justify-between gap-3 w-[calc(100%_-_20px)] align-middle">
        <span><strong className="text-[14px]">SpecKit</strong><span className="text-[12px] text-secondary ml-3">{family.stages.size} 个阶段 · {family.projects} 个项目 · {family.copies} 个副本</span><span className="block text-[12px] text-tertiary mt-1">规范、计划、任务、实施与核查 · 展开选择阶段和项目</span></span>
        <span className="inline-flex items-center gap-2"><span className="text-[11px] text-tertiary">近 {days} 天明确调用</span><FrequencyBadge count={family.total.explicit} days={days} state={state} /></span>
      </span>
    </summary>
    <div className="border-t border-border-subtle px-4 pb-3">
      <p className="text-[11px] text-tertiary py-3">调用按阶段名称合计一次；项目副本保留各自内容、来源与配置。</p>
      {[...family.stages].map(([name, copies]) => <details key={name} className="border-t border-border-subtle" aria-label={`${name} 项目副本`}>
        <summary className="cursor-pointer py-3 text-[12px]">
          <span className="inline-flex flex-wrap items-center justify-between gap-2 w-[calc(100%_-_20px)] align-middle">
            <span><strong>{name}</strong><span className="text-tertiary ml-2">{copies.length} 个副本</span></span>
            <FrequencyBadge count={frequencies.get(name)?.explicit || 0} days={days} state={state} />
          </span>
        </summary>
        <div className="pb-3 space-y-1">{copies.map(skill => {
          const project = skill.project_id ? projectsById.get(skill.project_id) : null;
          const label = project?.name || (skill.scope === 'global' ? '全局' : skill.project_id || '项目');
          return <div key={skill.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg-secondary px-3 py-2">
            <div className="min-w-0"><button className="text-[12px] font-medium hover:underline" onClick={() => onInspect(skill)}>{label}</button><p className="text-[11px] text-tertiary break-all">{skill.canonical_path || skill.path}</p></div>
            <div className="flex items-center gap-1 shrink-0">
              {managedIds.has(skill.id) && <button className="app-icon-button" aria-label={`查看 ${skill.name} · ${label}`} title="查看技能内容" onClick={() => onOpen(skill.id)}><FileSearch size={15} /></button>}
              <button className="app-icon-button" aria-label={`配置 ${skill.name} · ${label}`} title="查看来源与配置" onClick={() => onInspect(skill)}><SlidersHorizontal size={15} /></button>
            </div>
          </div>;
        })}</div>
      </details>)}
    </div>
  </details>;
}
