import { useCallback, useState } from 'react';
import { LogDrawer } from '../components/dashboard/LogDrawer';
import { RunForm } from '../components/dashboard/RunForm';
import { ScheduleList } from '../components/dashboard/ScheduleList';
import { ServiceStatus } from '../components/dashboard/ServiceStatus';
import { WorkflowDetail } from '../components/dashboard/WorkflowDetail';
import { WorkflowList } from '../components/dashboard/WorkflowList';
import { ResizablePanel } from '../components/ResizablePanel';

export function Dashboard() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <div className="app-layout">
        <ResizablePanel defaultWidth={300} minWidth={240} maxWidth={500} handle="right">
          <aside className="sidebar">
            <div className="sidebar-header">
              <span className="logo">TAP</span>
              <span className="logo-sub">Temporal Agent Platform</span>
            </div>

            <ServiceStatus />

            <RunForm
              onStarted={(id) => {
                bump();
                setActiveId(id);
              }}
              onScheduled={() => setScheduleRefresh((k) => k + 1)}
            />

            <ScheduleList refreshKey={scheduleRefresh} />

            <div className="sidebar-list-header">
              <span>実行履歴</span>
              <button type="button" className="btn-icon" onClick={bump} title="更新">
                &#x21bb;
              </button>
            </div>
            <WorkflowList activeId={activeId} onSelect={setActiveId} refreshKey={refreshKey} />
          </aside>
        </ResizablePanel>

        <main className="main-content">
          {activeId ? (
            <WorkflowDetail workflowId={activeId} onClose={() => setActiveId(null)} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">&#9654;</div>
              <p>
                左の実行履歴からワークフローを選ぶか、
                <br />
                タスクを入力して「実行」してください
              </p>
            </div>
          )}
        </main>
      </div>

      <LogDrawer />
    </>
  );
}
