import { Inject, Injectable } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { normalizeTaskDrafts, TaskDraft } from './dto/task-drafts.schema';
import type { AiProvider } from './openai/ai-provider';
import { callAiProvider } from './openai/call-ai-provider';
import { AI_PROVIDER } from './openai/openai.constants';

/** Bounds the prompt: the library is small today, but the titles go to the model verbatim. */
const MAX_TITLES_SENT = 200;

@Injectable()
export class AiTaskGeneratorService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly tasksService: TasksService,
  ) {}

  /** Drafts only; nothing is saved until an admin sends the chosen ones to POST /tasks/bulk. */
  async generate(prompt: string, count: number): Promise<TaskDraft[]> {
    const library = await this.tasksService.findAllUnpaginated();
    const titles = library.slice(0, MAX_TITLES_SENT).map((task) => task.title);

    const wire = await callAiProvider(
      () => this.aiProvider.generateTaskDrafts(prompt, count, titles),
      'AI task generator is temporarily unavailable',
    );
    return normalizeTaskDrafts(wire, count);
  }
}
