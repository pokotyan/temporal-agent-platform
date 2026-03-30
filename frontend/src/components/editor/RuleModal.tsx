import { useEffect, useState } from 'react';
import type { StepRule } from './types';

interface Props {
  rule: StepRule | null;
  stepNames: string[];
  isNew: boolean;
  onSave: (rule: StepRule) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function RuleModal({ rule, stepNames, isNew, onSave, onDelete, onClose }: Props) {
  const [condition, setCondition] = useState('');
  const [next, setNext] = useState('');

  useEffect(() => {
    if (rule) {
      setCondition(rule.condition);
      setNext(rule.next);
    }
  }, [rule]);

  const allTargets = [...stepNames, 'COMPLETE', 'ABORT'];

  return (
    <div className="modal-overlay rule-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-title">{isNew ? 'ルールを追加' : 'ルールを編集'}</div>
        <div className="prop-row">
          <label>条件</label>
          <input type="text" value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="例: レビュー完了" />
        </div>
        <div className="prop-row">
          <label>遷移先</label>
          <select value={next} onChange={(e) => setNext(e.target.value)}>
            {allTargets.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          {!isNew && (
            <button className="btn-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
              削除
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>キャンセル</button>
          <button className="btn-primary" onClick={() => onSave({ condition, next: next || allTargets[0]! })}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
