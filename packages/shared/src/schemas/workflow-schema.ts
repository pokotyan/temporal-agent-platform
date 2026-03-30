import { z } from 'zod';

/** Rule config schema */
export const RuleSchema = z.object({
  condition: z.string(),
  next: z.string().optional().default('COMPLETE'),
  status: z.string().optional(),
});

/** Report config schema */
export const ReportSchema = z.object({
  name: z.string(),
  format: z.enum(['markdown', 'json', 'text']).default('markdown'),
});

/** Temporal step overrides schema */
export const StepTemporalSchema = z
  .object({
    taskQueue: z.string().optional(),
    startToCloseTimeout: z.string().optional(),
    retryPolicy: z
      .object({
        maxAttempts: z.number().optional(),
        backoffCoefficient: z.number().optional(),
        initialInterval: z.string().optional(),
        maxInterval: z.string().optional(),
      })
      .optional(),
  })
  .optional();

/** Step config schema (recursive for parallel sub-steps) */
export const StepSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    name: z.string(),
    agent: z.string().optional(),
    skill: z.string().optional(),
    edit: z.boolean().optional().default(false),
    permission_mode: z.enum(['edit', 'readonly', 'full']).optional(),
    model: z.string().optional(),
    instruction_template: z.string().optional(),
    pass_previous_response: z.boolean().optional().default(false),
    rules: z.array(RuleSchema).optional(),
    report: ReportSchema.optional(),
    parallel: z.array(StepSchema).optional(),
    temporal: StepTemporalSchema,
  }),
);

/** Temporal workflow overrides schema */
export const WorkflowTemporalSchema = z
  .object({
    taskQueue: z.string().optional(),
    workflowExecutionTimeout: z.string().optional(),
    retryPolicy: z
      .object({
        maxAttempts: z.number().optional(),
        backoffCoefficient: z.number().optional(),
      })
      .optional(),
    schedule: z
      .object({
        cron: z.string(),
        overlap_policy: z.enum(['skip', 'cancel_other', 'allow_all']).optional(),
      })
      .optional(),
  })
  .optional();

/** Top-level workflow config schema */
export const WorkflowConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  task: z.string().optional(),
  initial_step: z.string(),
  max_iterations: z.number().default(15),
  steps: z.array(StepSchema).min(1),
  temporal: WorkflowTemporalSchema,
});

/** Agent config schema */
export const AgentConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt_file: z.string().optional(),
  system_prompt: z.string().optional(),
  model: z.string().optional(),
  allowed_tools: z.array(z.string()).optional(),
  requires_edit: z.boolean().optional().default(false),
  status_patterns: z.record(z.string()).optional(),
  sandbox: z
    .object({
      cpu: z.string().optional(),
      memory: z.string().optional(),
      timeout: z.string().optional(),
    })
    .optional(),
  default_instruction: z.string().optional(),
});

/** Ambient agent config schema */
export const AmbientConfigSchema = z.object({
  prompt: z.string(),
  interval: z.string(),
  stop_condition: z.string().optional(),
  max_iterations: z.number().optional().default(0),
  agent_config: z.string().optional(),
  model: z.string().optional(),
});
