import { ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';
import { TasksService } from '../tasks/tasks.service';
import { AiTaskGeneratorService } from './ai-task-generator.service';
import type { AiProvider } from './openai/ai-provider';

describe('AiTaskGeneratorService', () => {
  let aiProvider: { generateTaskDrafts: jest.Mock };
  let tasksService: { findAllUnpaginated: jest.Mock };
  let service: AiTaskGeneratorService;

  beforeEach(() => {
    aiProvider = { generateTaskDrafts: jest.fn() };
    tasksService = {
      findAllUnpaginated: jest
        .fn()
        .mockResolvedValue([{ title: 'Alternate picking' }]),
    };
    service = new AiTaskGeneratorService(
      aiProvider as unknown as AiProvider,
      tasksService as unknown as TasksService,
    );
  });

  it('tells the model the library titles and normalises its drafts', async () => {
    aiProvider.generateTaskDrafts.mockResolvedValue({
      tasks: [
        {
          title: ' Riff A ',
          description: 'Bars 1-4',
          category: 'repertoire',
          difficulty: 'medium',
          referenceLink: 'not a link',
        },
      ],
    });

    const drafts = await service.generate('7-string riffs', 1);

    expect(aiProvider.generateTaskDrafts).toHaveBeenCalledWith(
      '7-string riffs',
      1,
      ['Alternate picking'],
    );
    expect(drafts).toEqual([
      {
        title: 'Riff A',
        description: 'Bars 1-4',
        category: 'repertoire',
        difficulty: 'medium',
        referenceLink: null,
      },
    ]);
  });

  it('maps an OpenAI outage to 503', async () => {
    aiProvider.generateTaskDrafts.mockRejectedValue(
      new OpenAI.InternalServerError(500, undefined, 'down', new Headers()),
    );

    await expect(service.generate('riffs', 3)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
