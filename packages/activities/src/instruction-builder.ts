import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentConfig, StepConfig, StepContext } from '@tap/shared';

/** Default resources directory */
const RESOURCES_DIR = resolve(__dirname, '../../../resources');

/**
 * Build a fully composed instruction from faceted prompting components.
 *
 * Facets (in order, leveraging recency effect):
 * 1. Persona — agent's role and expertise
 * 2. Knowledge — reference materials and context
 * 3. Instruction — step-specific task and guidelines
 * 4. Output Contract — expected output structure with status tags
 * 5. Policy — rules and constraints (placed last for emphasis)
 */
export async function buildInstruction(step: StepConfig, task: string, context: StepContext): Promise<string> {
  // Skill steps: invoke via `claude -p "/{skill} {instruction}"` — no faceted wrapping
  if (step.skill) {
    const skillUserInput = context.lastUserInput || '(none)';
    const resolved = substituteTemplateVars(step.instructionTemplate || task, {
      task,
      previous_response: context.previousResponse || '(none)',
      previousResponse: context.previousResponse || '(none)',
      user_input: skillUserInput,
      userInput: skillUserInput,
      user_inputs: context.userInputs.join('\n') || '(none)',
      userInputs: context.userInputs.join('\n') || '(none)',
      iteration: String(context.iteration ?? ''),
      max_iterations: String(context.maxIterations ?? ''),
      reportDir: context.reportDir,
      gitDiff: context.gitDiff || '(none)',
    });
    return `/${step.skill} ${resolved}`;
  }

  const sections: string[] = [];
  const agentConfig = loadAgentConfigFromResources(step.agent || 'planner');

  // 1. Persona
  if (agentConfig?.systemPrompt) {
    sections.push(`## Persona\n\n${agentConfig.systemPrompt}`);
  } else if (agentConfig?.promptFile) {
    const promptPath = resolve(RESOURCES_DIR, agentConfig.promptFile);
    if (existsSync(promptPath)) {
      sections.push(`## Persona\n\n${readFileSync(promptPath, 'utf-8')}`);
    }
  }

  // 2. Knowledge
  if (context.knowledge.length > 0) {
    sections.push(`## Reference Knowledge\n\n${context.knowledge.join('\n\n---\n\n')}`);
  }

  // 3. Instruction (with template variable substitution)
  let instruction = step.instructionTemplate || agentConfig?.defaultInstruction || task;
  const userInput = context.lastUserInput || '(none)';
  instruction = substituteTemplateVars(instruction, {
    task,
    previous_response: context.previousResponse || '(none)',
    previousResponse: context.previousResponse || '(none)',
    user_input: userInput,
    userInput: userInput,
    user_inputs: context.userInputs.join('\n') || '(none)',
    userInputs: context.userInputs.join('\n') || '(none)',
    iteration: String(context.iteration ?? ''),
    max_iterations: String(context.maxIterations ?? ''),
    reportDir: context.reportDir,
    gitDiff: context.gitDiff || '(none)',
  });
  sections.push(`## Instruction\n\n${instruction}`);

  // 4. Output Contract (status tags derived from rules)
  if (step.rules && step.rules.length > 0) {
    const tagOptions = step.rules
      .filter((r) => !r.condition.startsWith('all(') && !r.condition.startsWith('any('))
      .map(
        (r, i) =>
          `  ${i + 1}. If "${r.condition}" → output \`[${step.name.toUpperCase()}:${conditionToTag(r.condition)}]\``,
      )
      .join('\n');

    if (tagOptions) {
      sections.push(
        `## Output Contract\n\nAfter completing your work, indicate your status by including one of these tags in your response:\n\n${tagOptions}`,
      );
    }
  }

  // 5. Policy (placed last for emphasis via recency effect)
  if (context.policies.length > 0) {
    sections.push(`## Policy\n\n${context.policies.join('\n\n')}`);
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Substitute template variables in instruction text
 */
function substituteTemplateVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Convert a rule condition to a status tag
 * e.g., "Plan is ready and complete" → "READY"
 *        "Cannot proceed" → "BLOCKED"
 */
function conditionToTag(condition: string): string {
  const lower = condition.toLowerCase();
  if (lower.includes('complete') || lower.includes('ready') || lower.includes('done')) return 'DONE';
  if (lower.includes('approved')) return 'APPROVED';
  if (lower.includes('needs fix') || lower.includes('needs revision')) return 'NEEDS_FIX';
  if (lower.includes('blocked') || lower.includes('cannot proceed')) return 'BLOCKED';
  if (lower.includes('unclear') || lower.includes('abort')) return 'ABORT';
  if (lower.includes('goal') && lower.includes('met')) return 'GOAL_MET';
  if (lower.includes('continue')) return 'CONTINUE';
  // Fallback: uppercase first significant word
  const words = condition.split(/\s+/).filter((w) => w.length > 3);
  return (words[0] || 'DONE').toUpperCase();
}

/**
 * Load agent config from resources directory
 */
function loadAgentConfigFromResources(agentName: string): AgentConfig | undefined {
  const paths = [
    resolve(RESOURCES_DIR, `agents/default/${agentName}.yaml`),
    resolve(RESOURCES_DIR, `agents/${agentName}.yaml`),
  ];

  for (const filePath of paths) {
    if (existsSync(filePath)) {
      try {
        const { loadAgentConfig } = require('@tap/shared/dist/yaml/loader');
        return loadAgentConfig(filePath);
      } catch {
        // Fall through
      }
    }
  }

  return undefined;
}
