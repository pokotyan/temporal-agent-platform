import type { RuleConfig, SubStepStatus } from '@tap/shared';

/**
 * Extract a status tag from agent output.
 * Tags follow the pattern: [STEP_NAME:TAG]
 * e.g., [PLAN:READY], [IMPLEMENT:DONE], [ARCH-REVIEW:APPROVED]
 */
export function extractTag(output: string, stepName: string): string | undefined {
  const pattern = new RegExp(`\\[${escapeRegex(stepName.toUpperCase())}:([A-Z_]+)\\]`);
  const match = output.match(pattern);
  return match?.[1]?.toLowerCase();
}

/**
 * Match a resolved tag to a rule's condition.
 * Returns the matching rule or undefined.
 */
export function matchTagToRule(
  rules: RuleConfig[] | undefined,
  tag: string,
  _stepName: string,
): RuleConfig | undefined {
  if (!rules) return undefined;

  const normalizedTag = tag.toLowerCase().replace(/_/g, ' ');

  return rules.find((rule) => {
    const normalizedCondition = rule.condition.toLowerCase().replace(/_/g, ' ');
    const normalizedNext = (rule.next || '').toLowerCase();
    // Direct match against condition text
    if (normalizedCondition.includes(normalizedTag)) return true;
    // Direct match against the next step name (evaluateStatus returns r.next when no r.status)
    if (normalizedTag === normalizedNext) return true;
    // Common aliases
    if (normalizedTag === 'ready' && normalizedCondition.includes('complete')) return true;
    if (normalizedTag === 'done' && normalizedCondition.includes('complete')) return true;
    if (normalizedTag === 'approved' && normalizedCondition.includes('approved')) return true;
    if (normalizedTag === 'needs fix' && normalizedCondition.includes('needs fix')) return true;
    if (normalizedTag === 'blocked' && normalizedCondition.includes('cannot proceed')) return true;
    if (normalizedTag === 'goal met' && normalizedCondition.includes('goal')) return true;
    return false;
  });
}

/**
 * Evaluate aggregate rules for parallel step results.
 * Supports: all("tag"), any("tag")
 */
export function evaluateAggregateRules(
  rules: RuleConfig[],
  subStepStatuses: SubStepStatus[] | undefined,
): RuleConfig | undefined {
  if (!subStepStatuses || subStepStatuses.length === 0) return undefined;

  for (const rule of rules) {
    const allMatch = rule.condition.match(/^all\("([^"]+)"\)$/);
    if (allMatch) {
      const requiredTag = allMatch[1];
      if (subStepStatuses.every((s) => s.status === requiredTag)) {
        return rule;
      }
      continue;
    }

    const anyMatch = rule.condition.match(/^any\("([^"]+)"\)$/);
    if (anyMatch) {
      const requiredTag = anyMatch[1];
      if (subStepStatuses.some((s) => s.status === requiredTag)) {
        return rule;
      }
    }
  }

  return undefined;
}

/**
 * Check if a step has rules that require AI judgment (non-aggregate, non-tag)
 */
export function requiresAIJudgment(rules?: RuleConfig[]): boolean {
  if (!rules) return false;
  return rules.some((r) => !r.condition.startsWith('all(') && !r.condition.startsWith('any('));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
