import { meters } from '../../observability/metrics/meters';
import { getTaskStats, GetTaskStatsArgsSchema } from './get-task-stats.tool';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const OTHER_USER_ID = 'a3f1c2d4-9999-4b2a-9c3d-000000000000';

type MockPracticeSessionsService = { getTaskStats: jest.Mock };

describe('getTaskStats', () => {
  let practiceSessionsService: MockPracticeSessionsService;

  beforeEach(() => {
    practiceSessionsService = { getTaskStats: jest.fn().mockResolvedValue([]) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('records ai_tool_duration_ms with the tool name and a success outcome', async () => {
    const recordSpy = jest.spyOn(meters.aiToolDurationMs, 'record');

    await getTaskStats({ practiceSessionsService }, USER_ID, {});

    expect(recordSpy).toHaveBeenCalledWith(expect.any(Number), {
      tool: 'get_task_stats',
      outcome: 'success',
    });
  });

  it('has no userId parameter in its Zod schema', () => {
    expect(GetTaskStatsArgsSchema.shape).not.toHaveProperty('userId');
  });

  it('resolves the requested user from the explicit userId argument, not from tool args', async () => {
    await getTaskStats({ practiceSessionsService }, USER_ID, {});

    expect(practiceSessionsService.getTaskStats).toHaveBeenCalledWith(
      USER_ID,
      14,
    );
  });

  it("never leaks another user's data regardless of which userId is passed", async () => {
    await getTaskStats({ practiceSessionsService }, OTHER_USER_ID, {});

    expect(practiceSessionsService.getTaskStats).toHaveBeenCalledWith(
      OTHER_USER_ID,
      14,
    );
  });

  it('passes through a custom days argument', async () => {
    await getTaskStats({ practiceSessionsService }, USER_ID, { days: 60 });

    expect(practiceSessionsService.getTaskStats).toHaveBeenCalledWith(
      USER_ID,
      60,
    );
  });

  it('returns the service result unchanged', async () => {
    const stats = [
      {
        taskId: 't1',
        title: 'Scales',
        timesPracticedRecently: 2,
        totalMinutesPracticedRecently: 20,
        lastPracticedAt: '2026-01-01T00:00:00.000Z',
        timesPracticedAllTime: 5,
      },
    ];
    practiceSessionsService.getTaskStats.mockResolvedValue(stats);

    await expect(
      getTaskStats({ practiceSessionsService }, USER_ID, {}),
    ).resolves.toEqual(stats);
  });
});
