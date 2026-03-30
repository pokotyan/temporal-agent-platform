import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentConfigSchema, AmbientConfigSchema, WorkflowConfigSchema } from '../schemas/workflow-schema';
import type { AgentConfig, AmbientConfig, StepConfig, WorkflowConfig } from '../types';

/**
 * Convert snake_case YAML keys to camelCase TypeScript types
 */
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        snakeToCamel(value),
      ]),
    );
  }
  return obj;
}

/**
 * Load and validate a workflow YAML file
 */
export function loadWorkflowConfig(filePath: string): WorkflowConfig {
  const raw = readFileSync(resolve(filePath), 'utf-8');
  const parsed = parseYaml(raw);
  const validated = WorkflowConfigSchema.parse(parsed);
  return snakeToCamel(validated) as WorkflowConfig;
}

/**
 * Load and validate an agent YAML file
 */
export function loadAgentConfig(filePath: string): AgentConfig {
  const raw = readFileSync(resolve(filePath), 'utf-8');
  const parsed = parseYaml(raw);
  const validated = AgentConfigSchema.parse(parsed);
  return snakeToCamel(validated) as AgentConfig;
}

/**
 * Load and validate an ambient agent config
 */
export function loadAmbientConfig(filePath: string): AmbientConfig {
  const raw = readFileSync(resolve(filePath), 'utf-8');
  const parsed = parseYaml(raw);
  const validated = AmbientConfigSchema.parse(parsed);
  return snakeToCamel(validated) as AmbientConfig;
}

/**
 * Parse a workflow YAML string (without file I/O)
 */
export function parseWorkflowYaml(yamlString: string): WorkflowConfig {
  const parsed = parseYaml(yamlString);
  const validated = WorkflowConfigSchema.parse(parsed);
  return snakeToCamel(validated) as WorkflowConfig;
}

/**
 * Resolve step by name from a workflow config
 */
export function findStep(config: WorkflowConfig, stepName: string): StepConfig | undefined {
  return config.steps.find((s) => s.name === stepName);
}

/**
 * Check if a step has tag-based rules (requiring Phase 3 judgment)
 */
export function hasTagBasedRules(rules?: Array<{ condition: string; next: string; status?: string }>): boolean {
  if (!rules) return false;
  return rules.some((r) => !r.condition.startsWith('all(') && !r.condition.startsWith('any('));
}
