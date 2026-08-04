import { Test, TestingModule } from '@nestjs/testing';
import { RoutineStatus } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { WeeklyRoutineCleanupModule } from '../src/weekly-routine-cleanup/weekly-routine-cleanup.module';
import { WeeklyRoutineCleanupService } from '../src/weekly-routine-cleanup/weekly-routine-cleanup.service';

// A fixed Monday used as the CLEANUP_WEEK_START override so the archiving
// boundary in these tests is deterministic, instead of depending on the real
// wall-clock "now" (which would make tests flaky right around a real Monday
// midnight boundary).
const FIXED_WEEK_START = '2026-07-27T00:00:00.000Z';

describe('WeeklyRoutineCleanupService (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: WeeklyRoutineCleanupService;

  beforeEach(async () => {
    process.env.CLEANUP_WEEK_START = FIXED_WEEK_START;

    moduleRef = await Test.createTestingModule({
      imports: [WeeklyRoutineCleanupModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(WeeklyRoutineCleanupService);

    await prisma.recording.deleteMany();
    await prisma.practiceSession.deleteMany();
    await prisma.routineTask.deleteMany();
    await prisma.routine.deleteMany();
    await prisma.task.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    delete process.env.CLEANUP_WEEK_START;
    await moduleRef.close();
  });

  const seedUser = (email: string) =>
    prisma.user.create({ data: { email, displayName: 'Jordan' } });

  const seedRoutine = (
    userId: string,
    overrides: { title: string; status: RoutineStatus; createdAt: string },
  ) =>
    prisma.routine.create({
      data: {
        userId,
        title: overrides.title,
        status: overrides.status,
        createdAt: new Date(overrides.createdAt),
      },
    });

  it('archives only active routines created before the week start', async () => {
    const user = await seedUser('cleanup-basic@example.com');
    const activeOld = await seedRoutine(user.id, {
      title: 'Old active routine',
      status: RoutineStatus.active,
      createdAt: '2026-07-20T12:00:00.000Z',
    });
    const activeThisWeek = await seedRoutine(user.id, {
      title: 'This week active routine',
      status: RoutineStatus.active,
      createdAt: '2026-07-27T08:00:00.000Z',
    });
    const alreadyArchived = await seedRoutine(user.id, {
      title: 'Already archived routine',
      status: RoutineStatus.archived,
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    const result = await service.run();

    expect(result.archivedCount).toBe(1);

    const [refreshedOld, refreshedThisWeek, refreshedArchived] =
      await Promise.all([
        prisma.routine.findUniqueOrThrow({ where: { id: activeOld.id } }),
        prisma.routine.findUniqueOrThrow({
          where: { id: activeThisWeek.id },
        }),
        prisma.routine.findUniqueOrThrow({
          where: { id: alreadyArchived.id },
        }),
      ]);

    expect(refreshedOld.status).toBe(RoutineStatus.archived);
    expect(refreshedThisWeek.status).toBe(RoutineStatus.active);
    expect(refreshedArchived.status).toBe(RoutineStatus.archived);
  });

  it('is idempotent across repeated runs', async () => {
    const user = await seedUser('cleanup-idempotent@example.com');
    await seedRoutine(user.id, {
      title: 'Old active routine',
      status: RoutineStatus.active,
      createdAt: '2026-07-20T12:00:00.000Z',
    });

    const first = await service.run();
    expect(first.archivedCount).toBe(1);

    const second = await service.run();
    expect(second.archivedCount).toBe(0);

    const routines = await prisma.routine.findMany({
      where: { userId: user.id },
    });
    expect(
      routines.every((routine) => routine.status === RoutineStatus.archived),
    ).toBe(true);
  });

  it('respects the CLEANUP_WEEK_START override for the week boundary', async () => {
    const user = await seedUser('cleanup-override@example.com');
    const beforeOverride = await seedRoutine(user.id, {
      title: 'Just before override boundary',
      status: RoutineStatus.active,
      createdAt: '2026-07-26T23:59:59.000Z',
    });
    const afterOverride = await seedRoutine(user.id, {
      title: 'Just after override boundary',
      status: RoutineStatus.active,
      createdAt: '2026-07-27T00:00:01.000Z',
    });

    const result = await service.run();
    expect(result.weekStart).toEqual(new Date(FIXED_WEEK_START));
    expect(result.archivedCount).toBe(1);

    const [refreshedBefore, refreshedAfter] = await Promise.all([
      prisma.routine.findUniqueOrThrow({ where: { id: beforeOverride.id } }),
      prisma.routine.findUniqueOrThrow({ where: { id: afterOverride.id } }),
    ]);
    expect(refreshedBefore.status).toBe(RoutineStatus.archived);
    expect(refreshedAfter.status).toBe(RoutineStatus.active);
  });
});
