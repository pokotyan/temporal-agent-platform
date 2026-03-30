import { type Node, useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { RuleModal } from './RuleModal';
import type { ParallelNodeData, ParallelSubStep, StepRule } from './types';

interface Props {
  node: Node;
  agents: string[];
  skills: string[];
  stepNames: string[];
  onDelete: (id: string) => void;
}

export function ParallelPropForm({ node, agents, skills, stepNames, onDelete }: Props) {
  const { setNodes } = useReactFlow();
  const data = node.data as ParallelNodeData;
  const [expandedSub, setExpandedSub] = useState<number | null>(null);
  const [ruleModal, setRuleModal] = useState<{ idx: number; isNew: boolean } | null>(null);

  const update = (patch: Partial<ParallelNodeData>) => {
    setNodes((nds) =>
      nds.map((n) => n.id === node.id ? { ...n, data: { ...n.data, ...patch } } : n),
    );
  };

  const updateSubStep = (idx: number, patch: Partial<ParallelSubStep>) => {
    const subSteps = data.subSteps.map((s, i) => i === idx ? { ...s, ...patch } : s);
    update({ subSteps });
  };

  const addSubStep = () => {
    const name = `sub-${Date.now().toString(36).slice(-4)}`;
    const subSteps = [...data.subSteps, {
      name, agent: agents[0] ?? 'planner', skill: '', instruction: '', rules: [],
    }];
    update({ subSteps });
    setExpandedSub(subSteps.length - 1);
  };

  const removeSubStep = (idx: number) => {
    update({ subSteps: data.subSteps.filter((_, i) => i !== idx) });
    setExpandedSub(null);
  };

  const updateRule = (idx: number, rule: StepRule) => {
    const rules = [...data.rules];
    if (idx >= 0) { rules[idx] = rule; } else { rules.push(rule); }
    update({ rules });
    setRuleModal(null);
  };

  const deleteRule = (idx: number) => {
    update({ rules: data.rules.filter((_, i) => i !== idx) });
    setRuleModal(null);
  };

  return (
    <div className="prop-panel">
      <div className="prop-form">
        <div className="prop-section">
          <div className="prop-section-title">並列ステップ設定</div>
          <div className="prop-row">
            <label>名前</label>
            <input type="text" value={data.label} onChange={(e) => update({ label: e.target.value })} />
          </div>
        </div>

        <div className="prop-section">
          <div className="prop-section-title">
            サブステップ ({data.subSteps.length})
            <button className="btn-add-rule" onClick={addSubStep}>+ 追加</button>
          </div>
          {data.subSteps.map((sub, idx) => (
            <div key={idx} style={{ marginBottom: 8 }}>
              <div
                className="rule-item"
                onClick={() => setExpandedSub(expandedSub === idx ? null : idx)}
                style={{ cursor: 'pointer' }}
              >
                <div className="rule-condition">{sub.name}</div>
                <div className="rule-next">{sub.skill ? `⚡ ${sub.skill}` : sub.agent}</div>
              </div>
              {expandedSub === idx && (
                <div style={{ padding: '8px 0 0 8px', borderLeft: '2px solid var(--accent)', marginLeft: 4, marginTop: 4 }}>
                  <div className="prop-row">
                    <label>名前</label>
                    <input type="text" value={sub.name} onChange={(e) => updateSubStep(idx, { name: e.target.value })} />
                  </div>
                  <div className="prop-row">
                    <label>実装タイプ</label>
                    <select
                      value={sub.skill ? 'skill' : 'agent'}
                      onChange={(e) => {
                        if (e.target.value === 'skill') {
                          updateSubStep(idx, { skill: skills[0] ?? '', agent: '' });
                        } else {
                          updateSubStep(idx, { skill: '', agent: agents[0] ?? 'planner' });
                        }
                      }}
                    >
                      <option value="agent">Agent</option>
                      <option value="skill">Skill</option>
                    </select>
                  </div>
                  {!sub.skill ? (
                    <div className="prop-row">
                      <label>エージェント</label>
                      <select value={sub.agent} onChange={(e) => updateSubStep(idx, { agent: e.target.value })}>
                        {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="prop-row">
                      <label>スキル</label>
                      <select value={sub.skill} onChange={(e) => updateSubStep(idx, { skill: e.target.value })}>
                        <option value="">(選択)</option>
                        {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="prop-row">
                    <label>指示</label>
                    <textarea
                      className="prop-textarea"
                      style={{ minHeight: 100 }}
                      value={sub.instruction}
                      onChange={(e) => updateSubStep(idx, { instruction: e.target.value })}
                    />
                  </div>
                  <button
                    className="btn-danger"
                    style={{ fontSize: 11, padding: '3px 8px', marginTop: 4 }}
                    onClick={() => removeSubStep(idx)}
                  >
                    サブステップを削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="prop-section">
          <div className="prop-section-title">
            集約ルール
            <button className="btn-add-rule" onClick={() => setRuleModal({ idx: -1, isNew: true })}>
              + 追加
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
            all(&quot;tag&quot;) / any(&quot;tag&quot;) でサブステップの結果を集約
          </div>
          <div className="rules-list">
            {data.rules.map((r, i) => (
              <div key={i} className="rule-item" onClick={() => setRuleModal({ idx: i, isNew: false })}>
                <div className="rule-condition">{r.condition || '(no condition)'}</div>
                <div className="rule-next">&rarr; <span>{r.next}</span></div>
              </div>
            ))}
          </div>
        </div>

        <div className="prop-section prop-danger">
          <button className="btn-delete-node" onClick={() => onDelete(node.id)}>
            このステップを削除
          </button>
        </div>
      </div>

      {ruleModal && (
        <RuleModal
          rule={ruleModal.idx >= 0 ? (data.rules[ruleModal.idx] ?? null) : { condition: '', next: 'COMPLETE' }}
          stepNames={stepNames}
          isNew={ruleModal.isNew}
          onSave={(rule) => updateRule(ruleModal.idx, rule)}
          onDelete={() => deleteRule(ruleModal.idx)}
          onClose={() => setRuleModal(null)}
        />
      )}
    </div>
  );
}
