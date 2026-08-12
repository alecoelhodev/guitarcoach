import { meters } from '../../observability/metrics/meters';
import {
  getRecentPracticeSessions,
  GetRecentPracticeSessionsArgsSchema,
} from './get-recent-practice-sessions.tool';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const OTHER_USER_ID = 'a3f1c2d4-9999-4b2a-9c3d-000000000000';

type MockPracticeSessionsService = { findRecent: jest.Mock };

describe('getRecentPracticeSessions', () => {
  let practiceSessionsService: MockPracticeSessionsService;

  beforeEach(() => {
    practiceSessionsService = { findRecent: jest.fn().mockResolvedValue([]) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('records ai_tool_duration_ms with the tool name and a success outcome', async () => {
    const recordSpy = jest.spyOn(meters.aiToolDurationMs, 'record');

    await getRecentPracticeSessions({ practiceSessionsService }, USER_ID, {});

    expect(recordSpy).toHaveBeenCalledWith(expect.any(Number), {
      tool: 'get_recent_practice_sessions',
      outcome: 'success',
    });
  });

  it('has no userId parameter in its Zod schema', () => {
    expect(GetRecentPracticeSessionsArgsSchema.shape).not.toHaveProperty(
      'userId',
    );
  });

  it('resolves the requested user from the explicit userId argument, not from tool args', async () => {
    await getRecentPracticeSessions({ practiceSessionsService }, USER_ID, {});

    expect(practiceSessionsService.findRecent).toHaveBeenCalledWith(
      USER_ID,
      14,
    );
  });

  it("never leaks another user's data regardless of which userId is passed", async () => {
    await getRecentPracticeSessions(
      { practiceSessionsService },
      OTHER_USER_ID,
      {},
    );

    expect(practiceSessionsService.findRecent).toHaveBeenCalledWith(
      OTHER_USER_ID,
      14,
    );
  });

  it('passes through a custom days argument', async () => {
    await getRecentPracticeSessions({ practiceSessionsService }, USER_ID, {
      days: 30,
    });

    expect(practiceSessionsService.findRecent).toHaveBeenCalledWith(
      USER_ID,
      30,
    );
  });

  it('maps sessions to the tool result shape, summing task durations', async () => {
    practiceSessionsService.findRecent.mockResolvedValue([
      {
        id: 's1',
        userId: USER_ID,
        routineId: 'r1',
        title: null,
        notes: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        routine: { id: 'r1', title: 'Daily warm-up' },
        sessionTasks: [
          {
            practiceSessionId: 's1',
            taskId: 't1',
            durationMinutes: 15,
            completed: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            task: { id: 't1', title: 'Scales' },
          },
          {
            practiceSessionId: 's1',
            taskId: 't2',
            durationMinutes: null,
            completed: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            task: { id: 't2', title: 'Chords' },
          },
        ],
      },
    ]);

    const result = await getRecentPracticeSessions(
      { practiceSessionsService },
      USER_ID,
      {},
    );

    expect(result).toEqual([
      {
        date: '2026-01-01T00:00:00.000Z',
        durationMinutes: 15,
        routineId: 'r1',
        routineTitle: 'Daily warm-up',
        tasks: [
          {
            taskId: 't1',
            title: 'Scales',
            durationMinutes: 15,
            completed: true,
          },
          {
            taskId: 't2',
            title: 'Chords',
            durationMinutes: null,
            completed: false,
          },
        ],
      },
    ]);
  });
});
