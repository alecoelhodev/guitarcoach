import { BadGatewayException } from '@nestjs/common';
import { z } from 'zod';
import { TaskCategory, TaskDifficulty } from '../../generated/prisma/enums';

// Wire schema for the structured output. Like PracticePlanSchema it carries no length
// limits, which strict-schema conversion doesn't reliably enforce; normalizeTaskDrafts
// applies the business rules. There is deliberately no link field: on a device every URL
// the model produced was broken, web search or not.
export const TaskDraftsSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum(TaskCategory),
      difficulty: z.enum(TaskDifficulty),
    }),
  ),
});

export type TaskDraftsWire = z.infer<typeof TaskDraftsSchema>;

export interface TaskDraft {
  title: string;
  description: string;
  category: TaskCategory;
  difficulty: TaskDifficulty;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * Model output is never trusted as-is: titles shorter than `CreateTaskDto` allows are
 * dropped and long text is clipped. Extra drafts are cut to `count`; none at all is a 502.
 */
export function normalizeTaskDrafts(
  wire: TaskDraftsWire,
  count: number,
): TaskDraft[] {
  const drafts = wire.tasks
    .map((task) => ({
      title: task.title.trim().slice(0, TITLE_MAX),
      description: task.description.trim().slice(0, DESCRIPTION_MAX),
      category: task.category,
      difficulty: task.difficulty,
    }))
    .filter((task) => task.title.length >= 2)
    .slice(0, count);

  if (drafts.length === 0) {
    throw new BadGatewayException('The AI returned no usable task drafts');
  }
  return drafts;
}
