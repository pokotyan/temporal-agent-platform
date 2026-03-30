import type { Edge, Node } from '@xyflow/react';
import type { ParallelNodeData, StepNodeData, StepRule, TerminalNodeData } from './types';

let uidCounter = 0;
function uid() {
  uidCounter++;
  return `n${uidCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface WorkflowMeta {
  name: string;
  task: string;
  maxIterations: string;
  timeout: string;
  cronMode: boolean;
  cronPreset: string;
  cronCustom: string;
  cronOverlap: string;
}

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  meta: WorkflowMeta;
}

export function parseYaml(yaml: string): ParseResult {
  const meta: WorkflowMeta = {
    name: '',
    task: '',
    maxIterations: '15',
    timeout: '',
    cronMode: false,
    cronPreset: '0 9 * * *',
    cronCustom: '',
    cronOverlap: 'skip',
  };

  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  if (nameMatch) meta.name = nameMatch[1]!.trim().replace(/^["']|["']$/g, '');

  const taskMatch = yaml.match(/^task:\s*["']?(.*?)["']?\s*$/m);
  if (taskMatch) meta.task = taskMatch[1]!.trim();

  const maxIterMatch = yaml.match(/^max_iterations:\s*(\d+)/m);
  if (maxIterMatch) meta.maxIterations = maxIterMatch[1]!;

  const timeoutMatch = yaml.match(/workflow_execution_timeout:\s*(\S+)/);
  if (timeoutMatch) meta.timeout = timeoutMatch[1]!;

  const cronMatch = yaml.match(/^\s+cron:\s*["']?([^\n"']+)["']?\s*$/m);
  if (cronMatch) {
    meta.cronMode = true;
    const cron = cronMatch[1]!.trim();
    const presets = ['0 9 * * *', '0 9 * * 1-5', '*/30 * * * *', '0 * * * *'];
    if (presets.includes(cron)) {
      meta.cronPreset = cron;
    } else {
      meta.cronPreset = 'custom';
      meta.cronCustom = cron;
    }
    const overlapMatch = yaml.match(/overlap_policy:\s*(\S+)/);
    if (overlapMatch) meta.cronOverlap = overlapMatch[1]!;
  }

  const stepDefs = parseSteps(yaml);

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const terminalSet = new Set<string>();

  nodes.push({
    id: '__START__',
    type: 'terminal',
    position: { x: 40, y: 250 },
    data: { label: 'START', variant: 'start' } satisfies TerminalNodeData,
    draggable: true,
  });

  for (let i = 0; i < stepDefs.length; i++) {
    const s = stepDefs[i]!;
    const nodeId = uid();
    s._id = nodeId;

    if (s.parallel && s.parallel.length > 0) {
      // Parallel node
      nodes.push({
        id: nodeId,
        type: 'parallel',
        position: { x: 220 + i * 320, y: 180 },
        data: {
          label: s.name,
          subSteps: s.parallel.map((sub) => ({
            name: sub.name,
            agent: sub.agent,
            skill: sub.skill,
            instruction: sub.instruction,
            rules: sub.rules,
          })),
          rules: s.rules,
        } satisfies ParallelNodeData,
        draggable: true,
      });
    } else {
      // Regular step node
      nodes.push({
        id: nodeId,
        type: 'step',
        position: { x: 220 + i * 280, y: 200 },
        data: {
          label: s.name,
          agent: s.agent,
          skill: s.skill,
          edit: s.edit,
          passPrev: s.passPrev,
          instruction: s.instruction,
          rules: s.rules,
        } satisfies StepNodeData,
        draggable: true,
      });
    }

    for (const r of s.rules) {
      if (r.next === 'COMPLETE' || r.next === 'ABORT') {
        terminalSet.add(r.next);
      }
    }
  }

  if (terminalSet.has('COMPLETE') || stepDefs.length > 0) {
    nodes.push({
      id: '__COMPLETE__',
      type: 'terminal',
      position: { x: 220 + stepDefs.length * 280, y: 200 },
      data: { label: 'COMPLETE', variant: 'complete' } satisfies TerminalNodeData,
      draggable: true,
    });
  }
  if (terminalSet.has('ABORT')) {
    nodes.push({
      id: '__ABORT__',
      type: 'terminal',
      position: { x: 220 + stepDefs.length * 280, y: 350 },
      data: { label: 'ABORT', variant: 'abort' } satisfies TerminalNodeData,
      draggable: true,
    });
  }

  if (stepDefs.length > 0) {
    edges.push({
      id: 'e-start',
      source: '__START__',
      target: stepDefs[0]!._id!,
      animated: false,
    });
  }

  for (const s of stepDefs) {
    for (let ri = 0; ri < s.rules.length; ri++) {
      const rule = s.rules[ri]!;
      let targetId: string;
      if (rule.next === 'COMPLETE') {
        targetId = '__COMPLETE__';
      } else if (rule.next === 'ABORT') {
        targetId = '__ABORT__';
      } else {
        const target = stepDefs.find((sd) => sd.name === rule.next);
        targetId = target?._id ?? '__COMPLETE__';
      }
      edges.push({
        id: `e-${s._id}-${ri}`,
        source: s._id!,
        target: targetId,
        label: rule.condition,
      });
    }
  }

  return { nodes, edges, meta };
}

interface StepDef {
  _id?: string;
  name: string;
  agent: string;
  skill: string;
  edit: boolean;
  passPrev: boolean;
  instruction: string;
  rules: StepRule[];
  parallel?: SubStepDef[];
}

interface SubStepDef {
  name: string;
  agent: string;
  skill: string;
  instruction: string;
  rules: StepRule[];
}

function parseSteps(yaml: string): StepDef[] {
  const steps: StepDef[] = [];
  const lines = yaml.split('\n');
  let inSteps = false;
  let current: StepDef | null = null;
  let inInstruction = false;
  let inRules = false;
  let inParallel = false;
  let inSubInstruction = false;
  let inSubRules = false;
  let currentSub: SubStepDef | null = null;
  const instructionLines: string[] = [];
  const subInstructionLines: string[] = [];

  function finalizeCurrent() {
    if (!current) return;
    if (inInstruction) current.instruction = instructionLines.join('\n').trimEnd();
    if (inParallel && currentSub) {
      if (inSubInstruction) currentSub.instruction = subInstructionLines.join('\n').trimEnd();
      current.parallel = current.parallel ?? [];
      current.parallel.push(currentSub);
    }
    steps.push(current);
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trimStart();
    const indent = raw.length - trimmed.length;

    if (trimmed.startsWith('steps:') && indent === 0) { inSteps = true; continue; }
    if (!inSteps) continue;

    // New top-level step
    if (trimmed.startsWith('- name:') && indent <= 2) {
      finalizeCurrent();
      current = {
        name: trimmed.replace('- name:', '').trim().replace(/^["']|["']$/g, ''),
        agent: 'planner', skill: '', edit: false, passPrev: false,
        instruction: '', rules: [],
      };
      inInstruction = false; inRules = false; inParallel = false;
      inSubInstruction = false; inSubRules = false;
      currentSub = null;
      instructionLines.length = 0;
      subInstructionLines.length = 0;
      continue;
    }

    if (!current) continue;

    // Inside parallel block
    if (inParallel) {
      // New sub-step inside parallel
      if (trimmed.startsWith('- name:') && indent >= 4 && indent <= 8) {
        if (currentSub) {
          if (inSubInstruction) currentSub.instruction = subInstructionLines.join('\n').trimEnd();
          current.parallel = current.parallel ?? [];
          current.parallel.push(currentSub);
        }
        currentSub = {
          name: trimmed.replace('- name:', '').trim().replace(/^["']|["']$/g, ''),
          agent: 'planner', skill: '', instruction: '', rules: [],
        };
        inSubInstruction = false; inSubRules = false;
        subInstructionLines.length = 0;
        continue;
      }

      if (currentSub) {
        if (trimmed.startsWith('skill:')) {
          currentSub.skill = trimmed.replace('skill:', '').trim().replace(/^["']|["']$/g, '');
        } else if (trimmed.startsWith('agent:')) {
          currentSub.agent = trimmed.replace('agent:', '').trim().replace(/^["']|["']$/g, '');
        } else if (trimmed.startsWith('instruction_template:')) {
          inSubInstruction = true; inSubRules = false; subInstructionLines.length = 0;
        } else if (inSubInstruction && (trimmed.startsWith('rules:') || trimmed.startsWith('- name:'))) {
          currentSub.instruction = subInstructionLines.join('\n').trimEnd();
          inSubInstruction = false;
          if (trimmed.startsWith('rules:')) inSubRules = true;
        } else if (inSubInstruction) {
          subInstructionLines.push(raw.replace(/^ {8}/, '').replace(/^ {6}/, ''));
        } else if (trimmed.startsWith('rules:')) {
          inSubRules = true; inSubInstruction = false;
        } else if (inSubRules && trimmed.startsWith('- condition:')) {
          const cond = trimmed.replace('- condition:', '').trim().replace(/^["']|["']$/g, '');
          const nextLine = lines[i + 1] ?? '';
          const nextTrimmed = nextLine.trimStart();
          let status = '';
          if (nextTrimmed.startsWith('status:')) {
            status = nextTrimmed.replace('status:', '').trim().replace(/^["']|["']$/g, '');
            i++;
          }
          currentSub.rules.push({ condition: cond, next: status });
        }
        continue;
      }

      // Top-level rules after parallel block (indent <= 4)
      if (trimmed.startsWith('rules:') && indent <= 4) {
        if (currentSub != null) {
          if (inSubInstruction) (currentSub as SubStepDef).instruction = subInstructionLines.join('\n').trimEnd();
          current.parallel = current.parallel ?? [];
          current.parallel.push(currentSub as SubStepDef);
          currentSub = null;
        }
        inParallel = false;
        inRules = true;
        continue;
      }
      continue;
    }

    // Regular step fields
    if (trimmed.startsWith('parallel:') && indent >= 2) {
      inParallel = true;
      if (inInstruction) {
        current.instruction = instructionLines.join('\n').trimEnd();
        inInstruction = false;
      }
      continue;
    }

    if (trimmed.startsWith('skill:')) {
      current.skill = trimmed.replace('skill:', '').trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('agent:')) {
      current.agent = trimmed.replace('agent:', '').trim().replace(/^["']|["']$/g, '');
    } else if (trimmed.startsWith('edit:')) {
      current.edit = trimmed.includes('true');
    } else if (trimmed.startsWith('pass_previous_response:')) {
      current.passPrev = trimmed.includes('true');
    } else if (trimmed.startsWith('instruction_template:')) {
      inInstruction = true; inRules = false; instructionLines.length = 0;
    } else if (inInstruction && (trimmed.startsWith('rules:') || trimmed.startsWith('- name:') || trimmed.startsWith('parallel:'))) {
      current.instruction = instructionLines.join('\n').trimEnd();
      inInstruction = false;
      if (trimmed.startsWith('rules:')) inRules = true;
      if (trimmed.startsWith('parallel:')) inParallel = true;
    } else if (inInstruction) {
      instructionLines.push(raw.replace(/^ {4}/, '').replace(/^ {2}/, ''));
    } else if (trimmed.startsWith('rules:')) {
      inRules = true; inInstruction = false;
    } else if (inRules && trimmed.startsWith('- condition:')) {
      const cond = trimmed.replace('- condition:', '').trim().replace(/^["']|["']$/g, '');
      const nextLine = lines[i + 1] ?? '';
      const nextTrimmed = nextLine.trimStart();
      let nextStep = '';
      if (nextTrimmed.startsWith('next:')) {
        nextStep = nextTrimmed.replace('next:', '').trim().replace(/^["']|["']$/g, '');
        i++;
      }
      current.rules.push({ condition: cond, next: nextStep });
    }
  }

  finalizeCurrent();
  return steps;
}

export function exportYaml(nodes: Node[], _edges: Edge[], meta: WorkflowMeta): string {
  const stepNodes = nodes.filter((n) => n.type === 'step' || n.type === 'parallel');
  const initialStep = (stepNodes[0]?.data as StepNodeData | ParallelNodeData | undefined)?.label ?? '';

  let yaml = `name: ${meta.name || 'unnamed'}\n`;
  yaml += `description: ""\n`;
  if (meta.task) yaml += `task: "${meta.task.replace(/"/g, '\\"')}"\n`;
  yaml += `initial_step: ${initialStep}\n`;
  yaml += `max_iterations: ${meta.maxIterations || '15'}\n\n`;

  const temporalLines = ['temporal:', '  task_queue: agent-tasks'];
  if (meta.timeout) temporalLines.push(`  workflow_execution_timeout: ${meta.timeout}`);
  if (meta.cronMode) {
    const cron = meta.cronPreset === 'custom' ? meta.cronCustom : meta.cronPreset;
    if (cron) {
      temporalLines.push(`  schedule:\n    cron: "${cron}"\n    overlap_policy: ${meta.cronOverlap}`);
    }
  }
  yaml += `${temporalLines.join('\n')}\n\n`;
  yaml += 'steps:\n';

  for (const node of stepNodes) {
    if (node.type === 'parallel') {
      const d = node.data as ParallelNodeData;
      yaml += `  - name: ${d.label}\n`;
      yaml += '    parallel:\n';
      for (const sub of d.subSteps) {
        yaml += `      - name: ${sub.name}\n`;
        if (sub.skill) {
          yaml += `        skill: ${sub.skill}\n`;
        } else {
          yaml += `        agent: ${sub.agent}\n`;
        }
        if (sub.instruction) {
          yaml += '        instruction_template: |\n';
          for (const line of sub.instruction.split('\n')) {
            yaml += `          ${line}\n`;
          }
        }
        if (sub.rules.length > 0) {
          yaml += '        rules:\n';
          for (const rule of sub.rules) {
            yaml += `          - condition: "${rule.condition}"\n`;
            yaml += `            status: ${rule.next}\n`;
          }
        }
      }
      if (d.rules.length > 0) {
        yaml += '    rules:\n';
        for (const rule of d.rules) {
          yaml += `      - condition: '${rule.condition}'\n`;
          yaml += `        next: ${rule.next}\n`;
        }
      }
    } else {
      const d = node.data as StepNodeData;
      yaml += `  - name: ${d.label}\n`;
      if (d.skill) {
        yaml += `    skill: ${d.skill}\n`;
      } else {
        yaml += `    agent: ${d.agent}\n`;
      }
      yaml += `    edit: ${d.edit}\n`;
      if (d.passPrev) yaml += `    pass_previous_response: true\n`;
      if (d.instruction) {
        yaml += '    instruction_template: |\n';
        for (const line of d.instruction.split('\n')) {
          yaml += `      ${line}\n`;
        }
      }
      if (d.rules.length > 0) {
        yaml += '    rules:\n';
        for (const rule of d.rules) {
          yaml += `      - condition: "${rule.condition}"\n`;
          yaml += `        next: ${rule.next}\n`;
        }
      }
    }
  }

  return yaml;
}
