import { useEffect, useRef, useState } from 'react';
import { deleteWorkflow, listWorkflows } from '../../api';
import type { WorkflowSummary } from '../../types';
import { timeAgo } from '../../utils';

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  refreshKey: number;
}

function workflowKey(wf: WorkflowSummary) {
  return `${wf.workflowId}:${wf.status}`;
}

/** Extract a group name from a workflow. Uses memo workflowName, or falls back to slug from ID. */
function getGroupName(wf: WorkflowSummary): string {
  if (wf.workflowName) return wf.workflowName;
  // Fallback: parse from ID pattern "tap-{timestamp}-{slug...}" or "tap-sched-{timestamp}-{slug}--workflow-..."
  const schedMatch = wf.workflowId.match(/^tap-sched-\d+-(.+?)--workflow-/);
  if (schedMatch) return schedMatch[1]!;
  const match = wf.workflowId.match(/^tap-\d+-(.+)$/);
  if (match) return match[1]!;
  return wf.workflowId;
}

interface WorkflowGroup {
  name: string;
  workflows: WorkflowSummary[];
  latestTime: string;
  hasRunning: boolean;
}

function groupWorkflows(workflows: WorkflowSummary[]): WorkflowGroup[] {
  const map = new Map<string, WorkflowSummary[]>();
  for (const wf of workflows) {
    const name = getGroupName(wf);
    const list = map.get(name) ?? [];
    list.push(wf);
    map.set(name, list);
  }
  const groups: WorkflowGroup[] = [];
  for (const [name, wfs] of map) {
    groups.push({
      name,
      workflows: wfs,
      latestTime: wfs[0]?.startTime ?? '',
      hasRunning: wfs.some((w) => w.status === 'RUNNING'),
    });
  }
  return groups;
}

export function WorkflowList({ activeId, onSelect, refreshKey }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fingerprint = useRef('');

  useEffect(() => {
    const load = () => {
      listWorkflows()
        .then((list) => {
          const filtered = list.filter((wf) => !wf.workflowId.includes('-step-'));
          const fp = filtered.map(workflowKey).join('|');
          if (fp !== fingerprint.current) {
            fingerprint.current = fp;
            setWorkflows(filtered);
          }
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [refreshKey]);

  // Auto-expand the group containing the active workflow
  useEffect(() => {
    if (activeId) {
      const wf = workflows.find((w) => w.workflowId === activeId);
      if (wf) setExpandedGroup(getGroupName(wf));
    }
  }, [activeId, workflows]);

  const handleDeleteGroup = async (group: WorkflowGroup, e: React.MouseEvent) => {
    e.stopPropagation();
    const nonRunning = group.workflows.filter((w) => w.status !== 'RUNNING');
    if (nonRunning.length === 0) return;
    setDeleting(true);
    try {
      await Promise.all(nonRunning.map((w) => deleteWorkflow(w.workflowId)));
      fingerprint.current = '';
      setWorkflows((prev) => prev.filter((w) => !nonRunning.some((d) => d.workflowId === w.workflowId)));
    } catch (err) {
      console.error('Failed to delete group:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteOne = async (wf: WorkflowSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    if (wf.status === 'RUNNING') return;
    setDeleting(true);
    try {
      await deleteWorkflow(wf.workflowId);
      fingerprint.current = '';
      setWorkflows((prev) => prev.filter((w) => w.workflowId !== wf.workflowId));
      if (activeId === wf.workflowId) onSelect('');
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    } finally {
      setDeleting(false);
    }
  };

  const groups = groupWorkflows(workflows);

  if (groups.length === 0) {
    return (
      <div className="workflow-list">
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
          まだ実行履歴がありません
        </div>
      </div>
    );
  }

  return (
    <div className="workflow-list">
      {groups.map((group) => {
        const isExpanded = expandedGroup === group.name;
        const hasActive = group.workflows.some((w) => w.workflowId === activeId);
        return (
          <div key={group.name}>
            <div
              className={`wf-group-header${hasActive ? ' active' : ''}`}
              onClick={() => setExpandedGroup(isExpanded ? null : group.name)}
            >
              <div className="wf-group-left">
                <span className="wf-group-arrow">{isExpanded ? '▼' : '▶'}</span>
                <span className="wf-group-name">{group.name}</span>
                <span className="wf-group-count">{group.workflows.length}</span>
              </div>
              <div className="wf-group-right">
                {group.hasRunning && <span className="running-dot" />}
                <span className="wf-item-time">{timeAgo(group.latestTime)}</span>
                <button
                  type="button"
                  className="btn-icon btn-delete-small"
                  title="完了済みの履歴を削除"
                  disabled={deleting}
                  onClick={(e) => handleDeleteGroup(group, e)}
                >
                  &times;
                </button>
              </div>
            </div>
            {isExpanded &&
              group.workflows.map((wf) => (
                <div
                  key={wf.workflowId}
                  className={`wf-item wf-item-nested${wf.workflowId === activeId ? ' active' : ''}`}
                  onClick={() => onSelect(wf.workflowId)}
                >
                  <div className="wf-item-top">
                    <span className="wf-item-id" title={wf.workflowId}>
                      {wf.workflowId}
                    </span>
                    <span className="wf-item-time">{timeAgo(wf.startTime)}</span>
                  </div>
                  <div className="wf-item-status">
                    {wf.status === 'RUNNING' && <span className="running-dot" />}
                    <span className={`status-badge status-${wf.status}`}>{wf.status}</span>
                    {wf.status !== 'RUNNING' && (
                      <button
                        type="button"
                        className="btn-icon btn-delete-small"
                        title="削除"
                        disabled={deleting}
                        onClick={(e) => handleDeleteOne(wf, e)}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
