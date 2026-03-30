import { useEffect, useState } from 'react';
import { listSchedules, listTemplates, startWorkflow } from '../../api';
import type { WorkflowTemplate } from '../../types';
import { getErrorMessage } from '../../utils';

interface Props {
  onStarted: (workflowId: string) => void;
  onScheduled: () => void;
}

export function RunForm({ onStarted, onScheduled }: Props) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listTemplates()
      .then((list) => {
        setTemplates(list);
        if (list.length > 0) setSelected(list[0]!.name);
      })
      .catch(() => {});
  }, []);

  const tpl = templates.find((t) => t.name === selected);

  const hint = (() => {
    const lines: string[] = [];
    if (tpl?.task) lines.push(tpl.task);
    if (tpl?.description) lines.push(tpl.description);
    if (!lines.length) return null;

    if (tpl?.scheduleCron) {
      return { text: `⏰ ${lines.join(' — ')} — cron: ${tpl.scheduleCron}`, loop: true };
    }
    if (tpl?.loop) {
      return {
        text: `🔁 ${lines.join(' — ')} — 目標達成まで自動ループ`,
        loop: true,
      };
    }
    return { text: lines.join(' — '), loop: false };
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      // Check for duplicate schedule if this is a cron workflow
      if (tpl?.scheduleCron) {
        const schedules = await listSchedules();
        const existing = schedules.find((s) => s.note === selected || s.note === tpl.name);
        if (existing) {
          if (!confirm(`「${tpl.name ?? selected}」は既に定期実行に登録されています。重複して登録しますか？`)) {
            return;
          }
        }
      }
      const result = await startWorkflow(selected);
      if (result.scheduled) {
        onScheduled();
      } else if (result.workflowId) {
        onStarted(result.workflowId);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const editWorkflow = () => {
    if (selected) window.open(`/editor?name=${encodeURIComponent(selected)}`, '_blank');
  };

  return (
    <div className="new-workflow-section">
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            title="エージェントのパイプライン（ワークフロー）を選択"
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.loop ? '🔁 ' : ''}{t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            onClick={editWorkflow}
            title="選択中のワークフローを編集"
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            編集
          </button>
        </div>
        {hint && <div className={`workflow-hint${hint.loop ? ' workflow-hint-loop' : ''}`}>{hint.text}</div>}
        <div className="form-run-row">
          <button type="submit" className="run-btn-full">
            {tpl?.scheduleCron ? '定期実行を登録' : '今すぐ実行'}
          </button>
          <a href="/editor" target="_blank" className="btn-new-wf" rel="noreferrer">
            + 新規
          </a>
        </div>
      </form>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
