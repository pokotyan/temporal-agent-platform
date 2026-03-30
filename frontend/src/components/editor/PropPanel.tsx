import { type Node, useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { RuleModal } from './RuleModal';
import type { StepNodeData, StepRule } from './types';

interface Props {
  node: Node | null;
  agents: string[];
  skills: string[];
  stepNames: string[];
  onDelete: (id: string) => void;
}

export function PropPanel({ node, agents, skills, stepNames, onDelete }: Props) {
  const { setNodes } = useReactFlow();
  const [ruleModal, setRuleModal] = useState<{ idx: number; isNew: boolean } | null>(null);

  if (!node || node.type !== 'step') {
    return (
      <div className="prop-panel">
        <div className="prop-empty">ステップを選択すると設定が表示されます</div>
      </div>
    );
  }

  const data = node.data as StepNodeData;
  const isSkill = !!data.skill;

  const update = (patch: Partial<StepNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const updateRule = (idx: number, rule: StepRule) => {
    const rules = [...data.rules];
    if (idx >= 0) {
      rules[idx] = rule;
    } else {
      rules.push(rule);
    }
    update({ rules });
    setRuleModal(null);
  };

  const deleteRule = (idx: number) => {
    const rules = data.rules.filter((_, i) => i !== idx);
    update({ rules });
    setRuleModal(null);
  };

  return (
    <div className="prop-panel">
      <div className="prop-form">
        <div className="prop-section">
          <div className="prop-section-title">ステップ設定</div>
          <div className="prop-row">
            <label>名前</label>
            <input type="text" value={data.label} onChange={(e) => update({ label: e.target.value })} />
          </div>
          <div className="prop-row">
            <label>実装タイプ</label>
            <select
              value={isSkill ? 'skill' : 'agent'}
              onChange={(e) => {
                if (e.target.value === 'skill') {
                  update({ skill: skills[0] ?? '', agent: '' });
                } else {
                  update({ skill: '', agent: agents[0] ?? 'planner' });
                }
              }}
            >
              <option value="agent">Agent（カスタム指示）</option>
              <option value="skill">Claude Code Skill</option>
            </select>
          </div>
          {!isSkill && (
            <div className="prop-row">
              <label>エージェント</label>
              <select value={data.agent} onChange={(e) => update({ agent: e.target.value })}>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
          {isSkill && (
            <div className="prop-row">
              <label>スキル名</label>
              <select value={data.skill} onChange={(e) => update({ skill: e.target.value })}>
                <option value="">（スキルを選択）</option>
                {skills.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="prop-row-check">
            <label>前のステップの出力を渡す</label>
            <input type="checkbox" checked={data.passPrev} onChange={(e) => update({ passPrev: e.target.checked })} />
          </div>
        </div>

        <div className="prop-section">
          <div className="prop-section-title">エージェントへの指示</div>
          <div className="prop-row">
            <textarea
              className="prop-textarea"
              value={data.instruction}
              onChange={(e) => update({ instruction: e.target.value })}
              placeholder="エージェントへの指示を記述"
            />
          </div>
          <details className="template-vars-help">
            <summary>テンプレート変数</summary>
            <dl className="template-vars-list">
              <dt>
                <code>{'{task}'}</code>
              </dt>
              <dd>ワークフローの task フィールド</dd>
              <dt>
                <code>{'{previousResponse}'}</code>
              </dt>
              <dd>前ステップの出力（pass_previous_response: true 時）</dd>
              <dt>
                <code>{'{userInput}'}</code>
              </dt>
              <dd>入力待ち（blocked）ステップでユーザーが送信した回答</dd>
              <dt>
                <code>{'{userInputs}'}</code>
              </dt>
              <dd>全ユーザー入力の累積</dd>
              <dt>
                <code>{'{iteration}'}</code>
              </dt>
              <dd>現在のイテレーション番号</dd>
              <dt>
                <code>{'{maxIterations}'}</code>
              </dt>
              <dd>最大イテレーション数</dd>
              <dt>
                <code>{'{gitDiff}'}</code>
              </dt>
              <dd>現在の git diff 出力</dd>
              <dt>
                <code>{'{reportDir}'}</code>
              </dt>
              <dd>レポート出力先ディレクトリのパス</dd>
            </dl>
          </details>
        </div>

        <div className="prop-section">
          <div className="prop-section-title">
            遷移ルール
            <button className="btn-add-rule" onClick={() => setRuleModal({ idx: -1, isNew: true })}>
              + 追加
            </button>
          </div>
          <div className="rules-list">
            {data.rules.map((r, i) => (
              <div key={i} className="rule-item" onClick={() => setRuleModal({ idx: i, isNew: false })}>
                <div className="rule-condition">{r.condition || '(no condition)'}</div>
                <div className="rule-next">
                  &rarr; <span>{r.next}</span>
                </div>
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
