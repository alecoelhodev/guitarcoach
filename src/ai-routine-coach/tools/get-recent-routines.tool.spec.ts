import { meters } from '../../observability/metrics/meters';
import {
  getRecentRoutines,
  GetRecentRoutinesArgsSchema,
} from './get-recent-routines.tool';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';
const OTHER_USER_ID = 'a3f1c2d4-9999-4b2a-9c3d-000000000000';

type MockRoutinesService = { findRecent: jest.Mock };

describe('getRecentRoutines', () => {
  let routinesService: MockRoutinesService;

  beforeEach(() => {
    routinesService = { findRecent: jest.fn().mockResolvedValue([]) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('records ai_tool_duration_ms with the tool name and a success outcome', async () => {
    const recordSpy = jest.spyOn(meters.aiToolDurationMs, 'record');

    await getRecentRoutines({ routinesService }, USER_ID, {});

    expect(recordSpy).toHaveBeenCalledWith(expect.any(Number), {
      tool: 'get_recent_routines',
      outcome: 'success',
    });
  });

  it('has no userId parameter in its Zod schema', () => {
    expect(GetRecentRoutinesArgsSchema.shape).not.toHaveProperty('userId');
  });

  it('resolves the requested user from the explicit userId argument, not from tool args', async () => {
    await getRecentRoutines({ routinesService }, USER_ID, {});

    expect(routinesService.findRecent).toHaveBeenCalledWith(USER_ID, 14);
  });

  it("never leaks another user's data regardless of which userId is passed", async () => {
    await getRecentRoutines({ routinesService }, OTHER_USER_ID, {});

    expect(routinesService.findRecent).toHaveBeenCalledWith(OTHER_USER_ID, 14);
  });

  it('passes through a custom days argument', async () => {
    await getRecentRoutines({ routinesService }, USER_ID, { days: 7 });

    expect(routinesService.findRecent).toHaveBeenCalledWith(USER_ID, 7);
  });

  it('maps routines to the tool result shape', async () => {
    routinesService.findRecent.mockResolvedValue([
      {
        id: 'r1',
        userId: USER_ID,
        title: 'Daily warm-up',
        status: 'active',
        notes: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        routineTasks: [
          {
            routineId: 'r1',
            taskId: 't1',
            position: 1,
            targetDurationMinutes: 15,
            createdAt: new Date(),
            updatedAt: new Date(),
            task: { id: 't1', title: 'Scales' },
          },
        ],
      },
    ]);

    const result = await getRecentRoutines({ routinesService }, USER_ID, {});

    expect(result).toEqual([
      {
        id: 'r1',
        title: 'Daily warm-up',
        createdAt: '2026-01-01T00:00:00.000Z',
        tasks: [
          {
            taskId: 't1',
            title: 'Scales',
            position: 1,
            targetDurationMinutes: 15,
          },
        ],
      },
    ]);
  });
});
