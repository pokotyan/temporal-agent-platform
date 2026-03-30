import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ParallelNodeData, ParallelSubStep } from '../types';

export function ParallelNode({ data, selected }: NodeProps) {
  const d = data as ParallelNodeData;

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div
        className="node-card"
        style={{
          minWidth: 160 + d.subSteps.length * 140,
          borderColor: selected ? 'var(--accent)' : undefined,
          boxShadow: selected ? '0 0 0 3px rgba(88,166,255,0.15)' : undefined,
          borderStyle: 'dashed',
        }}
      >
        <div className="node-header">
          <div className="node-icon" style={{ background: '#0d2a4a', color: 'var(--accent)' }}>≡</div>
          <div className="node-title">{d.label}</div>
          <span className="node-badge">parallel</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {d.subSteps.map((sub: ParallelSubStep) => (
            <div
              key={sub.name}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '6px 10px',
                minWidth: 120,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                {sub.name}
              </div>
              <div className="node-agent">
                {sub.skill ? `⚡ ${sub.skill}` : sub.agent}
              </div>
            </div>
          ))}
          {d.subSteps.length === 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 10px', fontStyle: 'italic' }}>
              右パネルからサブステップを追加
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
