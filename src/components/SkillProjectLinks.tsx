import { useEffect, useId, useState } from 'react';
import { ChevronDown, ChevronUp, FolderOpen, RefreshCw } from 'lucide-react';
import type { ManagedSkill } from '../lib/tauri';
import { workflowSnapshot } from '../lib/workflow';
import { governanceListScopes } from '../lib/governance';
import { usageSummaries } from '../lib/usage';
import { skillProjectLinks, type SkillProjectLink } from '../lib/skillProjectLinks';

export function SkillProjectLinks({ skill }: { skill: ManagedSkill }) {
  const [expanded, setExpanded] = useState(false);
  const [links, setLinks] = useState<SkillProjectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const id = useId();
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([workflowSnapshot(), governanceListScopes(), usageSummaries(null)]).then(([snapshot, scopes, summaries]) => {
      if (cancelled) return;
      const failures = [];
      if (snapshot.status === 'rejected') failures.push('项目目录读取失败');
      if (scopes.status === 'rejected') failures.push('部分统计项目可能无法对应');
      if (summaries.status === 'rejected') failures.push('使用记录读取失败');
      setLinks(skillProjectLinks(skill,
        snapshot.status === 'fulfilled' ? snapshot.value : { projects: [], skills: [], sync: { last_refresh: null, running: false, error: null, project_count: 0, skill_count: 0 }, bridge_path: '' },
        scopes.status === 'fulfilled' ? scopes.value : [],
        summaries.status === 'fulfilled' ? summaries.value : []));
      setErrors(failures);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [skill, revision]);

  return <div className="mt-3 rounded-xl border border-border-subtle bg-surface/70">
    <div className="flex items-center gap-2 px-4 py-3">
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-secondary">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span>关联项目</span>
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[12px] tabular-nums text-muted">{loading ? '读取中…' : `${links.length}${errors.length ? '（部分）' : ''}`}</span>
        {expanded ? <ChevronUp className="ml-auto h-3.5 w-3.5 text-muted" /> : <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted" />}
      </button>
      {expanded && <button type="button" aria-label="刷新关联项目" title="刷新关联项目" disabled={loading} className="app-icon-button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}><RefreshCw size={14} /></button>}
    </div>
    {expanded && <div id={id} className="border-t border-border-subtle px-4 py-3">
      <p className="mb-3 text-[12px] text-muted">项目目录与近 30 天使用证据；同名记录无法区分技能版本。全局可用不代表项目已使用。</p>
      {errors.length > 0 && <p role="alert" className="mb-2 text-[12px] text-secondary">{errors.join('；')}，可点击刷新重试。</p>}
      {loading ? <p role="status" className="text-[12px] text-muted">正在读取关联项目…</p> : links.length === 0 ? <p className="text-[12px] text-muted">暂未发现关联项目，不代表从未使用。</p> : <div className="grid max-h-64 gap-2 overflow-y-auto md:grid-cols-2">{links.map(link => <div key={link.path} className="min-w-0 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
        <p className="text-[13px] font-medium text-secondary">{link.name}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted" title={link.path}>{link.path}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-secondary">
          {link.local && <span className="rounded-full bg-accent-bg px-1.5 py-0.5">项目内技能</span>}
          {link.sameName && <span className="rounded-full bg-surface-hover px-1.5 py-0.5">同名项目副本</span>}
          {link.explicit > 0 && <span className="rounded-full bg-surface-hover px-1.5 py-0.5">明确调用 {link.explicit}</span>}
          {link.declared > 0 && <span className="rounded-full bg-surface-hover px-1.5 py-0.5">声明使用 {link.declared}</span>}
          {link.inferred > 0 && <span className="rounded-full bg-surface-hover px-1.5 py-0.5">读取说明 {link.inferred}</span>}
        </div>
      </div>)}</div>}
    </div>}
  </div>;
}
