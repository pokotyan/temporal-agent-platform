import { Link } from 'react-router-dom';

interface Props {
  name: string;
  onNameChange: (name: string) => void;
  maxIterations: string;
  onMaxIterationsChange: (v: string) => void;
  timeout: string;
  onTimeoutChange: (v: string) => void;
  cronMode: boolean;
  onCronModeToggle: () => void;
  cronPreset: string;
  onCronPresetChange: (v: string) => void;
  cronCustom: string;
  onCronCustomChange: (v: string) => void;
  cronOverlap: string;
  onCronOverlapChange: (v: string) => void;
  onAddStep: () => void;
  onAddParallelStep: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saveStatus: string;
}

export function TopBar(props: Props) {
  const showCustom = props.cronPreset === 'custom';

  return (
    <div className="editor-topbar">
      <Link to="/" className="topbar-back">
        &larr; Dashboard
      </Link>
      <div className="topbar-center">
        <input
          className="wf-name-input"
          value={props.name}
          onChange={(e) => props.onNameChange(e.target.value)}
          placeholder="workflow-name"
        />
        <span className="topbar-hint">{props.name || '...'}</span>
      </div>
      <div className="topbar-actions">
        <div className="topbar-param">
          <span className="topbar-param-label" title="ステップ間の遷移回数の上限（ループの安全キャップ、0=無制限）">最大遷移回数</span>
          <input
            className="topbar-param-input"
            value={props.maxIterations}
            onChange={(e) => props.onMaxIterationsChange(e.target.value)}
            title="0 = 無制限"
          />
        </div>
        <div className="topbar-param">
          <span className="topbar-param-label">タイムアウト</span>
          <input
            className="topbar-param-input topbar-param-input--wide"
            value={props.timeout}
            onChange={(e) => props.onTimeoutChange(e.target.value)}
            placeholder="2h"
          />
        </div>
        <div className="topbar-divider" />
        <button
          type="button"
          className={`wf-mode-btn${props.cronMode ? ' active' : ''}`}
          onClick={props.onCronModeToggle}
        >
          定期実行
        </button>
        {props.cronMode && (
          <div className="cron-field">
            <select
              className="cron-preset-select"
              value={props.cronPreset}
              onChange={(e) => props.onCronPresetChange(e.target.value)}
            >
              <option value="0 9 * * *">毎日 9:00</option>
              <option value="0 9 * * 1-5">平日 9:00</option>
              <option value="*/30 * * * *">30分毎</option>
              <option value="0 * * * *">1時間毎</option>
              <option value="custom">カスタム</option>
            </select>
            {showCustom && (
              <input
                className="cron-custom-input"
                value={props.cronCustom}
                onChange={(e) => props.onCronCustomChange(e.target.value)}
                placeholder="0 9 * * *"
              />
            )}
            <select
              className="cron-preset-select"
              value={props.cronOverlap}
              onChange={(e) => props.onCronOverlapChange(e.target.value)}
              title="overlap policy"
            >
              <option value="skip">スキップ（前回実行中なら今回は見送り）</option>
              <option value="cancel_other">前回を中止して新規実行</option>
              <option value="allow_all">すべて並行実行</option>
            </select>
          </div>
        )}
        <div className="topbar-divider" />
        <button type="button" className="btn-add-step" onClick={props.onAddStep}>
          + ステップ
        </button>
        <button type="button" className="btn-add-step" onClick={props.onAddParallelStep}>
          + 並列
        </button>
        <button type="button" className="btn-save" onClick={props.onSave}>
          保存
        </button>
        {props.onDelete && (
          <button type="button" className="btn-delete" onClick={props.onDelete}>
            削除
          </button>
        )}
        {props.saveStatus && <span className="save-status">{props.saveStatus}</span>}
      </div>
    </div>
  );
}
