import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { TerminalNodeData } from '../types';

export function TerminalNode({ data }: NodeProps) {
  const d = data as TerminalNodeData;
  const variant = d.variant;

  return (
    <div className={`node-terminal node-${variant}`}>
      {variant !== 'start' && <Handle type="target" position={Position.Left} />}
      <div className="node-label">{d.label}</div>
      {variant === 'start' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
