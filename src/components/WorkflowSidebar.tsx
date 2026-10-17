import { NavLink } from 'react-router-dom';
import { Activity, Network, BarChart3, Layers, Download, Bot, Settings } from 'lucide-react';

export function WorkflowSidebar() {
  return <aside className="w-[200px] shrink-0 border-r border-border-subtle bg-bg-secondary px-3 pb-4 pt-12 flex flex-col gap-5">
    <div className="px-2"><p className="text-[14px] font-semibold">Skills Manager</p><p className="text-[12px] text-tertiary mt-1">个人开发版 · 技能分类</p></div>
    <nav className="space-y-1">{[
      { to: '/', label: '技能分类', Icon: Activity, end: true },
      { to: '/my-skills', label: '技能库管理', Icon: Layers },
      { to: '/install', label: '安装技能', Icon: Download },
      { to: '/global-workspace', label: 'Agent 工作区', Icon: Bot },
      { to: '/skill-governance', label: '技能层级与覆盖', Icon: Network },
      { to: '/skill-usage', label: '使用频率与证据', Icon: BarChart3 },
      { to: '/settings', label: '设置', Icon: Settings },
    ].map(({ to, label, Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] ${isActive ? 'bg-accent-bg text-primary font-medium' : 'text-secondary hover:bg-background'}`}><Icon size={16} />{label}</NavLink>)}</nav>
    <p className="mt-auto px-2 text-[12px] leading-6 text-tertiary">项目自动发现<br />技能读取现有库<br />管理状态由后端确认</p>
  </aside>;
}
