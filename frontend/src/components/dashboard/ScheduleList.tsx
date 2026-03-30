import { useCallback, useEffect, useState } from 'react';
import { deleteSchedule, listSchedules, pauseSchedule, triggerSchedule } from '../../api';
import type { Schedule } from '../../types';
import { formatNextRun, getErrorMessage } from '../../utils';

interface Props {
  refreshKey: number;
}

export function ScheduleList({ refreshKey }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const load = useCallback(() => {
    listSchedules()
      .then(setSchedules)
      .catch(() => {});
  }, []);

  useEffect(() => {
    // refreshKey is used to trigger reload from parent
    void refreshKey;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [refreshKey, load]);

  const handleTrigger = async (id: string) => {
    try {
      await triggerSchedule(id);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handlePause = async (id: string, paused: boolean) => {
    try {
      await pauseSchedule(id, !paused);
      load();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`スケジュール「${id}」を削除しますか？`)) return;
    try {
      await deleteSchedule(id);
      load();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  if (schedules.length === 0) return null;

  return (
    <div className="schedule-section">
      <div className="sidebar-list-header">
        <span>定期実行中のタスク</span>
        <button className="btn-icon" onClick={load} title="更新">
          &#x21bb;
        </button>
      </div>
      <div className="schedule-list">
        {schedules.map((s) => {
          const cron = s.cronExpressions[0] ?? '—';
          const next = formatNextRun(s.nextActionTimes?.[0]);
          return (
            <div key={s.scheduleId} className="schedule-item">
              <div className="sched-main">
                <a
                  className="sched-label"
                  href={`http://localhost:8233/namespaces/default/schedules/${encodeURIComponent(s.scheduleId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.scheduleId}
                >
                  {s.note ?? s.scheduleId}
                </a>
                <div className="sched-meta">
                  <span className="sched-cron">{cron}</span>
                  <span className="sched-next">次回: {next}</span>
                  <span className={`sched-status ${s.paused ? 'sched-status-paused' : 'sched-status-active'}`}>
                    {s.paused ? '停止中' : '実行中'}
                  </span>
                </div>
              </div>
              <div className="sched-actions">
                <button className="btn-icon" onClick={() => handleTrigger(s.scheduleId)} title="今すぐ実行">
                  &#9654;
                </button>
                <button
                  className="btn-icon"
                  onClick={() => handlePause(s.scheduleId, s.paused)}
                  title={s.paused ? '再開' : '停止'}
                >
                  {s.paused ? '▶│' : '❙❙'}
                </button>
                <button
                  className="btn-icon"
                  onClick={() => handleDelete(s.scheduleId)}
                  title="削除"
                  style={{ color: 'var(--red)' }}
                >
                  &#10005;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
