import { Activity, BarChart3, Bot, ChevronDown, Layers, Network, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { ThemeSwitcher } from './ThemeSwitcher';

export function SkillManagementActions({ compact = false }: { compact?: boolean }) {
  const actions = [
    { to: '/my-skills', label: '技能库管理', Icon: Layers },
    { to: '/global-workspace', label: 'Agent 部署', Icon: Bot },
    { to: '/skill-governance', label: '层级与覆盖', Icon: Network },
    { to: '/skill-usage', label: '统计与证据', Icon: BarChart3 },
  ];
  return <details className={compact ? 'relative' : 'relative mt-3'}><summary className="app-button-secondary cursor-pointer list-none"><Layers size={16} />更多管理<ChevronDown size={14} /></summary><div className="absolute right-0 top-full z-30 mt-2 w-48 app-panel p-2 shadow-xl">{actions.map(({ to, label, Icon }) => <NavLink key={to} to={to} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-secondary hover:bg-background"><Icon size={14} />{label}</NavLink>)}</div></details>;
}

export function WorkflowSidebar() {
  const location = useLocation();
  const skillActive = location.pathname !== '/settings' && location.pathname !== '/skill-console';
  return <aside className="w-[176px] shrink-0 border-r border-border-subtle bg-bg-secondary px-2.5 pb-3 pt-12 flex flex-col gap-4">
    <div className="px-2"><p className="text-[14px] font-semibold">Skills Manager</p><p className="text-[12px] text-tertiary mt-1">技能管理 · Dev</p></div>
    <nav className="space-y-1"><NavLink to="/skill-console" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] ${isActive ? 'bg-accent-bg text-primary font-medium' : 'text-secondary hover:bg-background'}`}><Network size={16} />技能控制台</NavLink><NavLink to="/" end className={() => `flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] ${skillActive ? 'bg-accent-bg text-primary font-medium' : 'text-secondary hover:bg-background'}`}><Activity size={16} />技能</NavLink><NavLink to="/settings" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] ${isActive ? 'bg-accent-bg text-primary font-medium' : 'text-secondary hover:bg-background'}`}><Settings size={16} />设置</NavLink></nav>
    <div className="mt-auto space-y-3"><ThemeSwitcher /><p className="px-2 text-[11px] leading-5 text-tertiary">项目与技能自动发现</p></div>
  </aside>;
}
