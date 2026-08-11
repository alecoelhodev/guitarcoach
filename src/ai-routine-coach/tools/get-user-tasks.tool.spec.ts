import { getUserTasks, GetUserTasksArgsSchema } from './get-user-tasks.tool';

const USER_ID = 'a3f1c2d4-2222-4b2a-9c3d-000000000000';

const CATALOG = [
  {
    id: 't1',
    title: 'Chromatic warm-up',
    category: 'technique',
    difficulty: 'easy',
    referenceLink: 'https://example.com',
    description: 'A warm-up exercise',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 't2',
    title: 'Circle of fifths',
    category: 'theory',
    difficulty: 'medium',
    referenceLink: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

type MockTasksService = { findAllUnpaginated: jest.Mock };

describe('getUserTasks', () => {
  let tasksService: MockTasksService;

  beforeEach(() => {
    tasksService = {
      findAllUnpaginated: jest.fn().mockResolvedValue(CATALOG),
    };
  });

  it('has no userId parameter in its Zod schema', () => {
    expect(GetUserTasksArgsSchema.shape).not.toHaveProperty('userId');
  });

  it('returns the full catalog regardless of which user is asking', async () => {
    // Task has no per-user ownership in the current schema -- the catalog is
    // global/admin-managed, so this documents that behavior rather than
    // asserting an isolation guarantee the schema can't provide.
    const result = await getUserTasks({ tasksService }, USER_ID, {});

    expect(result).toHaveLength(2);
  });

  it('drops internal fields not useful for routine planning', async () => {
    const result = await getUserTasks({ tasksService }, USER_ID, {});

    expect(result[0]).toEqual({
      id: 't1',
      title: 'Chromatic warm-up',
      category: 'technique',
      difficulty: 'easy',
      description: 'A warm-up exercise',
    });
    expect(result[0]).not.toHaveProperty('referenceLink');
    expect(result[0]).not.toHaveProperty('createdAt');
  });

  it('filters by category when provided', async () => {
    const result = await getUserTasks({ tasksService }, USER_ID, {
      category: 'theory',
    });

    expect(result).toEqual([
      {
        id: 't2',
        title: 'Circle of fifths',
        category: 'theory',
        difficulty: 'medium',
        description: null,
      },
    ]);
  });
});
