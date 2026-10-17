import { useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { WorkflowSidebar as Sidebar } from "./WorkflowSidebar";
import { StatusBanner } from "./StatusBanner";
import { CommandPalette } from "./CommandPalette";
import { useApp } from "../context/AppContext";
import { useTranslation } from "react-i18next";
import { useDragWindow } from "../hooks/useDragWindow";
import { getManagementMode } from "../lib/tauri";

export function Layout() {
  const { t } = useTranslation();
  const { appError, refreshAppData } = useApp();
  const onDrag = useDragWindow();
  const navigate = useNavigate();
  const location = useLocation();
  const [managementMode, setManagementMode] = useState<boolean | null>(null);

  useEffect(() => {
    getManagementMode().then(setManagementMode).catch(() => setManagementMode(false));
  }, []);

  // Cmd+, to open Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        navigate("/settings");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        e.preventDefault();
        refreshAppData();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, refreshAppData]);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background text-primary">
      {/* Full-width top drag bar — spans sidebar + content, with bottom divider */}
      <div
        onMouseDown={onDrag}
        className="absolute inset-x-0 top-0 z-50 h-[28px] border-b border-border-subtle bg-bg-secondary"
      />
      <Sidebar />
      <div className="relative flex min-w-[600px] flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-[calc(28px+20px)] scrollbar-hide">
          <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-4">
            {appError ? (
              <StatusBanner
                compact
                title={t("common.dataOutOfDate")}
                description={appError}
                actionLabel={t("common.retry")}
                onAction={refreshAppData}
                tone="danger"
              />
            ) : null}
            <div className="px-1 text-[11px] text-tertiary" role="status">
              {managementMode === true
                ? "Skills Manager Dev · 正在管理共享技能库"
                : managementMode === false
                  ? "Skills Manager Dev · 隔离开发模式 · 当前操作不会修改正式技能库。"
                  : "Skills Manager Dev · 正在确认管理模式…"}
            </div>
            {location.pathname !== '/' && location.pathname !== '/settings' && location.pathname !== '/skill-console' && <button className="app-button-secondary self-start" onClick={() => navigate('/')}>← 返回技能</button>}
            <Outlet />
          </div>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
