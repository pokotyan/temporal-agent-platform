import { type EdgeProps, useInternalNode } from '@xyflow/react';

export function SelfLoopEdge({ id, source, label, selected, style }: EdgeProps) {
  const node = useInternalNode(source);
  if (!node) return null;

  const nodeWidth = node.measured?.width ?? 180;
  const nodeX = node.internals.positionAbsolute.x;
  const nodeY = node.internals.positionAbsolute.y;

  // Arc above the node
  const cx = nodeX + nodeWidth / 2;
  const topY = nodeY;
  const r = 40;

  const path = `M${cx - 20},${topY} C${cx - 20},${topY - r * 2} ${cx + 20},${topY - r * 2} ${cx + 20},${topY}`;

  const labelX = cx;
  const labelY = topY - r * 2 - 8;

  return (
    <g>
      <path
        id={id}
        className="react-flow__edge-path"
        d={path}
        style={{
          ...style,
          stroke: selected ? '#ffda44' : 'var(--border)',
          strokeWidth: selected ? 3 : 2,
          fill: 'none',
          filter: selected ? 'drop-shadow(0 0 4px rgba(255, 218, 68, 0.6))' : undefined,
          markerEnd: 'url(#react-flow__arrowclosed)',
        }}
      />
      {label && (
        <>
          <rect
            x={labelX - 60}
            y={labelY - 10}
            width={120}
            height={18}
            rx={4}
            ry={4}
            className="react-flow__edge-textbg"
          />
          <text
            x={labelX}
            y={labelY + 3}
            textAnchor="middle"
            className="react-flow__edge-text"
            style={selected ? { fill: '#ffda44', fontWeight: 700 } : undefined}
          >
            {String(label).length > 20 ? `${String(label).slice(0, 18)}…` : String(label)}
          </text>
        </>
      )}
    </g>
  );
}
