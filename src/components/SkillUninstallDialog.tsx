import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from './ConfirmDialog';
import { useApp } from '../context/AppContext';
import { deleteManagedSkill } from '../lib/tauri';
import { invoke } from '@tauri-apps/api/core';
import { getErrorMessage } from '../lib/error';

export interface UninstallTarget { id: string; name: string; path: string; managed: boolean }

export function SkillUninstallDialog({ target, onClose, onRemoved }: {
  target: UninstallTarget;
  onClose: () => void;
  onRemoved: (target: UninstallTarget) => void;
}) {
  const { refreshAppData } = useApp();
  async function uninstall() {
    try {
      if (target.managed) await deleteManagedSkill(target.id);
      else await invoke<void>('workflow_uninstall_project', { skillId: target.id, expectedPath: target.path });
    } catch (error) {
      toast.error(getErrorMessage(error, '卸载失败，请重试'));
      return false;
    }
    onRemoved(target);
    toast.success(`已卸载 ${target.name}`);
    try { await refreshAppData(); }
    catch { toast.warning('技能已卸载，清单刷新失败，请点击刷新重试。'); }
    return true;
  }
  return createPortal(<ConfirmDialog
    open title={`卸载 ${target.name}`} confirmLabel="确认卸载" lockWhileRunning
    message={target.managed
      ? '将删除共享技能库中的这项技能、预设关联及已同步到各 Agent 的部署。独立导入来源与其他项目副本保留；历史使用统计保留。'
      : '将删除下方路径对应的当前项目技能目录及其中的文件。共享库、其他项目的同名副本和历史使用统计保留。'}
    details={[target.path]} onClose={onClose} onConfirm={uninstall}
  />, document.body);
}
