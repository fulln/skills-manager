import { Bot, ChevronRight, FolderGit2, Sparkles } from 'lucide-react';
import { evidenceLabels, type LiveUsageEvent } from '../lib/liveUsage';

const agents: Record<string, string> = { codex: 'Codex', claude_code: 'Claude Code', pi: 'Pi' };

export function SkillUsageFlow({ event }: { event: LiveUsageEvent | null }) {
  if (!event) return <div className="rounded-lg border border-dashed border-border-subtle px-4 py-5 text-[12px] text-tertiary text-center">等待真实技能事件，收到后展示 AI → 项目 → Skill 关联。</div>;
  const project = event.project_path?.split('/').filter(Boolean).at(-1) || '未归属项目';
  const nodes = [
    { label: 'AI', name: event.agent ? agents[event.agent] || event.agent : '未知 Agent', detail: '日志记录的 Agent', Icon: Bot },
    { label: '项目', name: project, detail: event.project_path || '日志未提供项目路径', Icon: FolderGit2 },
    { label: 'Skill', name: event.skill, detail: evidenceLabels[event.evidence], Icon: Sparkles },
  ];
  return <div className="overflow-x-auto" aria-label="当前事件的 AI、项目与技能关联"><ol className="flex min-w-[520px] items-center py-1">
    {nodes.map((node, index) => <li key={node.label} className={`flex min-w-0 items-center ${index === 0 ? 'w-[22%]' : 'flex-1'}`}>
      {index > 0 && <div aria-hidden="true" className="flex w-12 shrink-0 items-center px-1 text-tertiary"><span className="flex-1 border-t border-dashed border-border-subtle" /><ChevronRight size={13} /></div>}
      <div className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${index === 2 ? 'border-accent-border bg-accent-bg' : 'border-border-subtle bg-background'}`}>
        <div className="flex items-center gap-2"><node.Icon size={16} className="shrink-0 text-secondary" /><span className="text-[11px] text-tertiary">{node.label}</span></div>
        <p className="mt-1 truncate text-[13px] font-semibold" title={node.name}>{node.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-tertiary" title={node.detail}>{node.detail}</p>
      </div>
    </li>)}
  </ol></div>;
}
