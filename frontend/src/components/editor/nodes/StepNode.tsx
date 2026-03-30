import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { StepNodeData } from '../types';

export function StepNode({ data, selected }: NodeProps) {
  const d = data as StepNodeData;
  const badges: string[] = [];
  if (d.edit) badges.push('edit');
  if (d.passPrev) badges.push('prev');

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div
        className="node-card"
        style={selected ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px rgba(88,166,255,0.15)' } : undefined}
      >
        <div className="node-header">
          <div className="node-icon">&#9654;</div>
          <div className="node-title">{d.label}</div>
        </div>
        <div className="node-agent">{d.skill ? `⚡ ${d.skill}` : d.agent}</div>
        {badges.length > 0 && (
          <div className="node-badges">
            {badges.map((b) => (
              <span key={b} className="node-badge">
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
