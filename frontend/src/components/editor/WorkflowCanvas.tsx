import {
  applyNodeChanges,
  Background,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type OnNodesChange,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SelfLoopEdge } from './edges/SelfLoopEdge';
import { ParallelNode } from './nodes/ParallelNode';
import { StepNode } from './nodes/StepNode';
import { TerminalNode } from './nodes/TerminalNode';

const nodeTypes = {
  step: StepNode,
  parallel: ParallelNode,
  terminal: TerminalNode,
};

const edgeTypes = {
  selfLoop: SelfLoopEdge,
};

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (nodes: Node[]) => void;
  onNodeSelect: (id: string | null) => void;
}

export function WorkflowCanvas({ nodes, edges, onNodesChange, onNodeSelect }: Props) {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const { fitView } = useReactFlow();
  const prevNodeCount = useRef(0);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Re-fit view when node count changes (step added/removed, terminal appears)
  useEffect(() => {
    if (nodes.length !== prevNodeCount.current) {
      prevNodeCount.current = nodes.length;
      setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 50);
    }
  }, [nodes.length, fitView]);

  // Apply selected state to edges
  const styledEdges = edges.map((e) => ({
    ...e,
    selected: e.id === selectedEdgeId,
  }));

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => onNodesChange(applyNodeChanges(changes, nodesRef.current)),
    [onNodesChange],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) => {
      onNodeSelect(selected.length === 1 ? (selected[0]?.id ?? null) : null);
    },
    [onNodeSelect],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback((_event, edge) => {
    setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeId(null);
  }, []);

  return (
    <div className="canvas-wrap" style={{ flex: 1 }}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onSelectionChange={handleSelectionChange}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        edgesReconnectable={false}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background gap={24} size={1} color="#30363d" />
      </ReactFlow>
    </div>
  );
}
