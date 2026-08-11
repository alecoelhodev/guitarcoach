import { BadGatewayException } from '@nestjs/common';
import { z } from 'zod';

// Wire schema for the OpenAI Responses API structured output (`text.format`,
// via zodTextFormat()). Deliberately has no .min()/.positive()/etc: OpenAI's
// strict-schema conversion doesn't reliably enforce those constraints, so
// business rules are enforced separately in assertValidPracticePlan below
// rather than trusted to the model or the schema conversion.
export const PracticePlanTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  durationMinutes: z.number(),
});

export const PracticePlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  totalDurationMinutes: z.number(),
  tasks: z.array(PracticePlanTaskSchema),
  requiresConfirmation: z.boolean(),
});

export type PracticePlanTask = z.infer<typeof PracticePlanTaskSchema>;
export type PracticePlan = z.infer<typeof PracticePlanSchema>;

// Task durations may reasonably differ from the requested total (the model
// rounds, adds warm-up/cooldown, etc.) but shouldn't diverge wildly.
const DURATION_TOLERANCE_RATIO = 0.2;

export function assertValidPracticePlan(plan: PracticePlan): void {
  if (plan.title.trim().length === 0) {
    throw new BadGatewayException(
      'AI returned a practice plan with an empty title',
    );
  }

  if (plan.tasks.length === 0) {
    throw new BadGatewayException('AI returned a practice plan with no tasks');
  }

  if (
    plan.tasks.some(
      (task) =>
        !Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0,
    )
  ) {
    throw new BadGatewayException(
      'AI returned a practice plan with a non-positive task duration',
    );
  }

  const totalTaskDuration = plan.tasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0,
  );
  const tolerance = plan.totalDurationMinutes * DURATION_TOLERANCE_RATIO;

  if (Math.abs(totalTaskDuration - plan.totalDurationMinutes) > tolerance) {
    throw new BadGatewayException(
      `AI returned task durations (${totalTaskDuration}m) that do not reasonably match the requested total (${plan.totalDurationMinutes}m)`,
    );
  }
}
