import type { Edge, Node } from '@xyflow/react';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { deleteTemplate, listAgents, listSkills, loadTemplate, saveTemplate } from '../api';
import { ParallelPropForm } from '../components/editor/ParallelPropForm';
import { PropPanel } from '../components/editor/PropPanel';
import { TopBar } from '../components/editor/TopBar';
import type { ParallelNodeData, StepNodeData, TerminalNodeData } from '../components/editor/types';
import { WorkflowCanvas } from '../components/editor/WorkflowCanvas';
import { exportYaml, parseYaml, type WorkflowMeta } from '../components/editor/yaml-utils';
import { ResizablePanel } from '../components/ResizablePanel';
import { getErrorMessage } from '../utils';

/**
 * Build edges from rules + ensure required terminal nodes exist in the node list.
 * Mutates nothing — returns new edges and any terminal nodes that need to be added.
 */
function buildEdges(nodes: Node[]): Edge[] {
  const edges: Edge[] = [];
  const stepNodes = nodes.filter((n) => n.type === 'step' || n.type === 'parallel');

  // START → first step
  const startNode = nodes.find((n) => n.id === '__START__');
  if (startNode && stepNodes.length > 0) {
    edges.push({
      id: 'e-start',
      source: '__START__',
      target: stepNodes[0]!.id,
      type: 'smoothstep',
    });
  }

  // Rules → edges
  for (const node of stepNodes) {
    const data = node.data as StepNodeData | ParallelNodeData;
    for (let ri = 0; ri < data.rules.length; ri++) {
      const rule = data.rules[ri]!;
      let targetId: string;
      if (rule.next === 'COMPLETE') {
        targetId = '__COMPLETE__';
      } else if (rule.next === 'ABORT') {
        targetId = '__ABORT__';
      } else {
        const target = stepNodes.find((n) => {
          const d = n.data as StepNodeData | ParallelNodeData;
          return d.label === rule.next;
        });
        targetId = target?.id ?? '__COMPLETE__';
      }
      const isSelfLoop = targetId === node.id;
      edges.push({
        id: `e-${node.id}-${ri}`,
        source: node.id,
        target: targetId,
        label: rule.condition,
        type: isSelfLoop ? 'selfLoop' : 'smoothstep',
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
      });
    }
  }

  return edges;
}

/** Ensure terminal nodes exist in the nodes array based on step rules. */
function ensureTerminalNodes(nodes: Node[]): Node[] {
  const stepNodes = nodes.filter((n) => n.type === 'step' || n.type === 'parallel');
  if (stepNodes.length === 0) {
    // No steps — remove any terminals
    return nodes.filter((n) => n.type !== 'terminal');
  }

  const hasTerminal = (id: string) => nodes.some((n) => n.id === id);
  const needsAbort = stepNodes.some((n) => {
    const d = n.data as StepNodeData | ParallelNodeData;
    return d.rules.some((r) => r.next === 'ABORT');
  });
  const maxX = stepNodes.reduce((max, n) => Math.max(max, n.position.x), 0);

  let result = [...nodes];

  // Always have START + COMPLETE when steps exist
  if (!hasTerminal('__START__')) {
    result.push({
      id: '__START__',
      type: 'terminal',
      position: { x: 40, y: 250 },
      data: { label: 'START', variant: 'start' } satisfies TerminalNodeData,
      draggable: true,
    });
  }
  if (!hasTerminal('__COMPLETE__')) {
    result.push({
      id: '__COMPLETE__',
      type: 'terminal',
      position: { x: maxX + 280, y: 200 },
      data: { label: 'COMPLETE', variant: 'complete' } satisfies TerminalNodeData,
      draggable: true,
    });
  }

  // ABORT only when referenced
  if (needsAbort && !hasTerminal('__ABORT__')) {
    result.push({
      id: '__ABORT__',
      type: 'terminal',
      position: { x: maxX + 280, y: 350 },
      data: { label: 'ABORT', variant: 'abort' } satisfies TerminalNodeData,
      draggable: true,
    });
  }
  // Remove ABORT if no longer needed
  if (!needsAbort) {
    result = result.filter((n) => n.id !== '__ABORT__');
  }

  return result;
}

function EditorInner() {
  const [searchParams] = useSearchParams();
  const loadName = searchParams.get('name');

  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agents, setAgents] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState('');

  const [meta, setMeta] = useState<WorkflowMeta>({
    name: '',
    task: '',
    maxIterations: '15',
    timeout: '',
    cronMode: false,
    cronPreset: '0 9 * * *',
    cronCustom: '',
    cronOverlap: 'skip',
  });

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => setAgents(['planner', 'coder', 'reviewer']));
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  useEffect(() => {
    if (!loadName) return;
    loadTemplate(loadName)
      .then(({ yaml }) => {
        const result = parseYaml(yaml);
        setNodes(result.nodes);
        setMeta(result.meta);
      })
      .catch((err) => {
        setSaveStatus(`Load failed: ${getErrorMessage(err)}`);
      });
  }, [loadName]);

  const updateMeta = useCallback((patch: Partial<WorkflowMeta>) => {
    setMeta((m) => ({ ...m, ...patch }));
  }, []);

  // Ensure terminal nodes are in sync with rules
  const nodesWithTerminals = useMemo(() => ensureTerminalNodes(nodes), [nodes]);

  // Derive edges from rules
  const edges = useMemo(() => buildEdges(nodesWithTerminals), [nodesWithTerminals]);

  const stepNodes = useMemo(
    () => nodesWithTerminals.filter((n) => n.type === 'step' || n.type === 'parallel'),
    [nodesWithTerminals],
  );

  const addStep = useCallback(() => {
    const id = `n${Date.now()}`;
    const count = nodes.filter((n) => n.type === 'step' || n.type === 'parallel').length;
    const newNode: Node = {
      id,
      type: 'step',
      position: { x: 300 + (count % 5) * 220, y: 150 + Math.floor(count / 5) * 160 },
      data: {
        label: `step-${id.slice(-4)}`,
        agent: agents[0] ?? 'planner',
        skill: '',
        edit: false,
        passPrev: false,
        instruction: '',
        rules: [],
      } satisfies StepNodeData,
      draggable: true,
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedId(id);
  }, [nodes, agents]);

  const addParallelStep = useCallback(() => {
    const id = `p${Date.now()}`;
    const count = nodes.filter((n) => n.type === 'step' || n.type === 'parallel').length;
    const newNode: Node = {
      id,
      type: 'parallel',
      position: { x: 300 + (count % 5) * 280, y: 150 + Math.floor(count / 5) * 160 },
      data: {
        label: `parallel-${id.slice(-4)}`,
        subSteps: [],
        rules: [],
      } satisfies ParallelNodeData,
      draggable: true,
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedId(id);
  }, [nodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setSelectedId(null);
  }, []);

  const handleSave = useCallback(async () => {
    const name = meta.name.trim();
    if (!name) {
      alert('ワークフロー名を入力してください');
      return;
    }
    const yaml = exportYaml(nodesWithTerminals, edges, meta);
    try {
      await saveTemplate(name, yaml);
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      setSaveStatus(`Error: ${getErrorMessage(err)}`);
    }
  }, [nodesWithTerminals, edges, meta]);

  const handleDelete = useCallback(async () => {
    const name = meta.name.trim();
    if (!name) return;
    if (!confirm(`ワークフロー「${name}」を削除しますか？`)) return;
    try {
      await deleteTemplate(name);
      window.location.href = '/';
    } catch (err) {
      setSaveStatus(`削除失敗: ${getErrorMessage(err)}`);
    }
  }, [meta.name]);

  const selectedNode = useMemo(
    () => nodesWithTerminals.find((n) => n.id === selectedId) ?? null,
    [nodesWithTerminals, selectedId],
  );

  const stepNames = useMemo(() => stepNodes.map((n) => (n.data as StepNodeData | ParallelNodeData).label), [stepNodes]);

  const renderPropPanel = () => {
    if (!selectedNode || selectedNode.type === 'terminal') {
      return (
        <div className="prop-panel">
          <div className="prop-empty">ステップを選択すると設定が表示されます</div>
        </div>
      );
    }
    if (selectedNode.type === 'parallel') {
      return (
        <ParallelPropForm
          node={selectedNode}
          agents={agents}
          skills={skills}
          stepNames={stepNames}
          onDelete={deleteNode}
        />
      );
    }
    return (
      <PropPanel node={selectedNode} agents={agents} skills={skills} stepNames={stepNames} onDelete={deleteNode} />
    );
  };

  return (
    <div className="editor-body">
      <TopBar
        name={meta.name}
        onNameChange={(name) => updateMeta({ name })}
        maxIterations={meta.maxIterations}
        onMaxIterationsChange={(v) => updateMeta({ maxIterations: v })}
        timeout={meta.timeout}
        onTimeoutChange={(v) => updateMeta({ timeout: v })}
        cronMode={meta.cronMode}
        onCronModeToggle={() => updateMeta({ cronMode: !meta.cronMode })}
        cronPreset={meta.cronPreset}
        onCronPresetChange={(v) => updateMeta({ cronPreset: v })}
        cronCustom={meta.cronCustom}
        onCronCustomChange={(v) => updateMeta({ cronCustom: v })}
        cronOverlap={meta.cronOverlap}
        onCronOverlapChange={(v) => updateMeta({ cronOverlap: v })}
        onAddStep={addStep}
        onAddParallelStep={addParallelStep}
        onSave={handleSave}
        onDelete={loadName ? handleDelete : undefined}
        saveStatus={saveStatus}
      />
      <div className="editor-layout">
        <WorkflowCanvas
          nodes={nodesWithTerminals}
          edges={edges}
          onNodesChange={setNodes}
          onNodeSelect={setSelectedId}
        />
        <ResizablePanel defaultWidth={300} minWidth={240} maxWidth={600}>
          {renderPropPanel()}
        </ResizablePanel>
      </div>
    </div>
  );
}

export function Editor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}
