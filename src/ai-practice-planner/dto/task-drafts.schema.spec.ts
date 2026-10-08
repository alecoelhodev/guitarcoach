import { BadGatewayException } from '@nestjs/common';
import { normalizeTaskDrafts, TaskDraftsWire } from './task-drafts.schema';

function draft(
  overrides: Partial<TaskDraftsWire['tasks'][number]> = {},
): TaskDraftsWire['tasks'][number] {
  return {
    title: 'Learn the Pull Me Under intro',
    description: 'Bars 1-8 at 70 bpm.',
    category: 'repertoire',
    difficulty: 'hard',
    ...overrides,
  };
}

describe('normalizeTaskDrafts', () => {
  it('keeps well-formed drafts as they are, trimmed', () => {
    const [result] = normalizeTaskDrafts(
      { tasks: [draft({ title: '  Riff A  ' })] },
      1,
    );

    expect(result).toEqual({
      title: 'Riff A',
      description: 'Bars 1-8 at 70 bpm.',
      category: 'repertoire',
      difficulty: 'hard',
    });
  });

  it('clips long text and skips titles too short for the library', () => {
    const result = normalizeTaskDrafts(
      {
        tasks: [
          draft({ title: 'x' }),
          draft({ title: 't'.repeat(250), description: 'd'.repeat(2500) }),
        ],
      },
      5,
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toHaveLength(200);
    expect(result[0].description).toHaveLength(2000);
  });

  it('returns no more than were asked for', () => {
    const result = normalizeTaskDrafts(
      { tasks: [draft(), draft(), draft()] },
      2,
    );

    expect(result).toHaveLength(2);
  });

  it('treats a reply with nothing usable as a bad gateway', () => {
    expect(() => normalizeTaskDrafts({ tasks: [] }, 3)).toThrow(
      BadGatewayException,
    );
  });
});
