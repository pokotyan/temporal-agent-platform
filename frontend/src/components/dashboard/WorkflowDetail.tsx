import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelWorkflow, getWorkflow, getWorkflowSteps, signalWorkflow } from '../../api';
import type { StepInfo, WorkflowDetail as WorkflowDetailType } from '../../types';
import { formatDuration, getErrorMessage } from '../../utils';

interface Props {
  workflowId: string;
  onClose: () => void;
}

export function WorkflowDetail({ workflowId, onClose }: Props) {
  const [wf, setWf] = useState<WorkflowDetailType | null>(null);
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [signalOpen, setSignalOpen] = useState(false);
  const [signalText, setSignalText] = useState('');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [detail, stepList] = await Promise.all([getWorkflow(workflowId), getWorkflowSteps(workflowId)]);
      setWf(detail);
      setSteps(stepList);
      setError('');
      if (detail.status !== 'RUNNING' && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [workflowId]);

  useEffect(() => {
    setSelectedStep(null);
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const handleSignal = async () => {
    if (!signalText.trim()) return;
    try {
      await signalWorkflow(workflowId, signalText.trim());
      setSignalText('');
      setSignalOpen(false);
      refresh();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleCancel = async () => {
    if (!confirm('このワークフローを中止しますか？')) return;
    try {
      await cancelWorkflow(workflowId);
      refresh();
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const selectedOutput = selectedStep && wf?.stepOutputs?.[selectedStep];
  const isBlocked = wf?.state?.status === 'blocked';

  // Extract the last step output as the "question" from the agent
  const blockedQuestion = (() => {
    if (!isBlocked || !wf?.stepOutputs) return null;
    const outputs = Object.values(wf.stepOutputs);
    const last = outputs[outputs.length - 1];
    if (!last) return null;
    // Show last 500 chars as context
    return last.length > 500 ? `...${last.slice(-500)}` : last;
  })();

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div>
          <a
            className="detail-wf-id"
            href={`http://localhost:8233/namespaces/default/workflows/${encodeURIComponent(wf?.workflowId ?? workflowId)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Temporal UI で開く"
          >
            {wf?.workflowId ?? workflowId}
          </a>
          {error ? (
            <div className="detail-meta-row">
              <span className="error">{error}</span>
            </div>
          ) : (
            wf && (
              <div className="detail-meta-row">
                <Meta label="ステータス">
                  {isBlocked ? (
                    <span className="status-badge status-blocked">入力待ち</span>
                  ) : (
                    <span className={`status-badge status-${wf.status}`}>{wf.status}</span>
                  )}
                </Meta>
                <Meta label="ワークフロー">
                  <span>{wf.workflowName ?? '-'}</span>
                </Meta>
                <Meta label="開始">
                  <span>{wf.startTime ? new Date(wf.startTime).toLocaleString('ja-JP') : '-'}</span>
                </Meta>
                {wf.state?.iteration != null && (
                  <Meta label="イテレーション">
                    <span>{wf.state.iteration}</span>
                  </Meta>
                )}
                <Meta label="経過時間">
                  <span>{formatDuration(wf.startTime, wf.closeTime)}</span>
                </Meta>
              </div>
            )
          )}
        </div>
        <div className="detail-header-actions">
          {wf?.status === 'RUNNING' && !isBlocked && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setSignalOpen(true)}>
                追加指示を送る
              </button>
              <button className="btn-danger" onClick={handleCancel}>
                中止
              </button>
            </div>
          )}
          {isBlocked && (
            <button className="btn-danger" onClick={handleCancel}>
              中止
            </button>
          )}
          <button className="btn-icon" onClick={onClose} title="Close">
            &times;
          </button>
        </div>
      </div>

      {isBlocked && (
        <div className="blocked-input-panel">
          <div className="blocked-header">
            <span className="blocked-icon">&#9888;</span>
            <span>ワークフローが入力を待っています</span>
          </div>
          {blockedQuestion && (
            <pre className="blocked-context">{blockedQuestion}</pre>
          )}
          <div className="blocked-form">
            <input
              value={signalText}
              onChange={(e) => setSignalText(e.target.value)}
              placeholder="回答を入力してください"
              onKeyDown={(e) => e.key === 'Enter' && handleSignal()}
              autoFocus
            />
            <button className="btn-primary" onClick={handleSignal}>
              送信
            </button>
          </div>
        </div>
      )}

      {signalOpen && !isBlocked && (
        <div className="signal-form">
          <input
            value={signalText}
            onChange={(e) => setSignalText(e.target.value)}
            placeholder="追加の指示を入力（例：issueは5件にして）"
            onKeyDown={(e) => e.key === 'Enter' && handleSignal()}
          />
          <button className="btn-primary" onClick={handleSignal}>
            送信
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setSignalOpen(false);
              setSignalText('');
            }}
          >
            キャンセル
          </button>
        </div>
      )}

      <div className="detail-body">
        <div className="timeline-panel">
          <div className="panel-title">ステップ実行履歴</div>
          <div className="timeline">
            {steps.length === 0 ? (
              <div className="timeline-empty">まだステップがありません（起動中かもしれません）</div>
            ) : (
              steps.map((s) => (
                <div key={s.workflowId} className="step-card-wrap">
                  <div className={`step-node node-${s.status}`} />
                  <div
                    className={`step-card${selectedStep === s.step ? ' selected' : ''}`}
                    onClick={() => setSelectedStep(s.step)}
                  >
                    <div className="step-card-top">
                      <span className="step-name">{s.step}</span>
                      <span className="step-iter">#{s.iteration}</span>
                    </div>
                    <div className="step-bottom">
                      <span className={`status-badge status-${s.status}`}>{s.status}</span>
                      <span className="step-duration">{formatDuration(s.startTime, s.closeTime)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="output-panel">
          <div className="panel-title">{selectedStep ? `出力 — ${selectedStep}` : 'ステップの出力'}</div>
          <pre className="output-pre">{selectedOutput ?? '左のステップをクリックすると出力内容が表示されます。'}</pre>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{children}</span>
    </div>
  );
}
