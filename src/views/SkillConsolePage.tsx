import { SkillConsole } from '../components/SkillConsole';

export function SkillConsolePage() {
  return <div className="app-page gap-4">
    <header><h1 className="app-page-title">技能控制台</h1><p className="mt-1 text-[12px] text-secondary">查看 AI、项目与技能关系，按事件核对使用证据。</p></header>
    <SkillConsole />
  </div>;
}
