import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeContext } from '../context/ThemeContext';
import type { Theme } from '../hooks/useTheme';

const options: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '系统', Icon: Monitor },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useThemeContext();
  return <div aria-label="主题" className="rounded-lg border border-border-subtle bg-background p-1"><div className="mb-1 px-2 text-[11px] text-tertiary">主题</div><div className="grid grid-cols-3 gap-1">{options.map(({ value, label, Icon }) => <button key={value} type="button" aria-label={label} aria-pressed={theme === value} onClick={() => setTheme(value)} className={`flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] transition-colors ${theme === value ? 'bg-accent-bg text-primary' : 'text-tertiary hover:bg-surface-hover hover:text-secondary'}`}><Icon size={14} />{label}</button>)}</div></div>;
}
