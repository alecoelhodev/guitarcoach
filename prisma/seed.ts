// Development seed data: 5 users (1 admin + 4 regular), 10 tasks, and 5
// routines with tasks attached. Safe to re-run — every entity is looked up
// by its natural key first and left untouched if it already exists.
import dotenv from 'dotenv';
import { expand } from 'dotenv-expand';
import {
  Task,
  TaskCategory,
  TaskDifficulty,
} from '../src/generated/prisma/client';
import { createAuth } from '../src/auth/auth';
import { RedisRateLimitStorage } from '../src/auth/redis-rate-limit-storage';
import { PrismaService } from '../src/prisma/prisma.service';

expand(dotenv.config());

// Not a real secret: every seeded account shares this password so new
// developers can log in with any of the seeded emails right away.
const SEED_PASSWORD = 'Password123!';

interface SeedUser {
  email: string;
  name: string;
  role: 'admin' | 'user';
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@guitarcoach.dev', name: 'Ada Admin', role: 'admin' },
  { email: 'alice@guitarcoach.dev', name: 'Alice Anderson', role: 'user' },
  { email: 'bob@guitarcoach.dev', name: 'Bob Baker', role: 'user' },
  { email: 'carol@guitarcoach.dev', name: 'Carol Chen', role: 'user' },
  { email: 'dave@guitarcoach.dev', name: 'Dave Diaz', role: 'user' },
];

interface SeedTask {
  title: string;
  category: TaskCategory;
  difficulty: TaskDifficulty;
  description?: string;
}

const SEED_TASKS: SeedTask[] = [
  {
    title: 'Chromatic finger warm-up',
    category: 'technique',
    difficulty: 'easy',
  },
  {
    title: 'Major scale in one position',
    category: 'technique',
    difficulty: 'easy',
  },
  {
    title: 'Alternate picking drills',
    category: 'technique',
    difficulty: 'medium',
  },
  {
    title: 'Barre chord transitions',
    category: 'technique',
    difficulty: 'medium',
  },
  {
    title: 'Sweep picking arpeggios',
    category: 'technique',
    difficulty: 'hard',
  },
  { title: 'Circle of fifths', category: 'theory', difficulty: 'easy' },
  { title: 'Intervals and triads', category: 'theory', difficulty: 'medium' },
  { title: 'Modes of the major scale', category: 'theory', difficulty: 'hard' },
  {
    title: 'Learn a 12-bar blues progression',
    category: 'repertoire',
    difficulty: 'medium',
  },
  {
    title: 'Learn a full song from tab',
    category: 'repertoire',
    difficulty: 'hard',
  },
];

interface SeedRoutine {
  userEmail: string;
  title: string;
  taskTitles: string[];
}

const SEED_ROUTINES: SeedRoutine[] = [
  {
    userEmail: 'admin@guitarcoach.dev',
    title: 'Admin daily practice',
    taskTitles: [
      'Chromatic finger warm-up',
      'Alternate picking drills',
      'Circle of fifths',
    ],
  },
  {
    userEmail: 'alice@guitarcoach.dev',
    title: "Alice's warm-up routine",
    taskTitles: [
      'Major scale in one position',
      'Barre chord transitions',
      'Intervals and triads',
      'Learn a 12-bar blues progression',
    ],
  },
  {
    userEmail: 'bob@guitarcoach.dev',
    title: "Bob's technique builder",
    taskTitles: [
      'Chromatic finger warm-up',
      'Sweep picking arpeggios',
      'Modes of the major scale',
    ],
  },
  {
    userEmail: 'carol@guitarcoach.dev',
    title: "Carol's practice plan",
    taskTitles: [
      'Alternate picking drills',
      'Barre chord transitions',
      'Learn a full song from tab',
    ],
  },
  {
    userEmail: 'dave@guitarcoach.dev',
    title: "Dave's session",
    taskTitles: [
      'Major scale in one position',
      'Intervals and triads',
      'Learn a 12-bar blues progression',
      'Learn a full song from tab',
    ],
  },
];

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set. Add it to .env (see .env.example).');
}

const prisma = new PrismaService();
const auth = createAuth(prisma, new RedisRateLimitStorage(process.env.REDIS_URL));

async function seedUser(
  seed: SeedUser,
): Promise<{ id: string; email: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: seed.email },
  });
  if (existing) {
    return existing;
  }

  const created = await auth.api.createUser({
    body: {
      email: seed.email,
      password: SEED_PASSWORD,
      name: seed.name,
      role: seed.role,
      data: { emailVerified: true },
    },
  });

  return created.user;
}

async function seedTask(seed: SeedTask): Promise<Task> {
  const existing = await prisma.task.findFirst({
    where: { title: seed.title },
  });
  if (existing) {
    return existing;
  }

  return prisma.task.create({ data: seed });
}

async function seedRoutine(
  seed: SeedRoutine,
  userIdByEmail: Map<string, string>,
  taskIdByTitle: Map<string, string>,
): Promise<void> {
  const userId = userIdByEmail.get(seed.userEmail);
  if (!userId) {
    throw new Error(
      `Seed data error: no seeded user for email "${seed.userEmail}"`,
    );
  }

  const existing = await prisma.routine.findFirst({
    where: { userId, title: seed.title },
  });
  if (existing) {
    return;
  }

  const routine = await prisma.routine.create({
    data: { userId, title: seed.title, status: 'active' },
  });

  await prisma.routineTask.createMany({
    data: seed.taskTitles.map((title, index) => {
      const taskId = taskIdByTitle.get(title);
      if (!taskId) {
        throw new Error(`Seed data error: no seeded task titled "${title}"`);
      }
      return { routineId: routine.id, taskId, position: index + 1 };
    }),
  });
}

async function main(): Promise<void> {
  const users = await Promise.all(SEED_USERS.map(seedUser));
  const userIdByEmail = new Map(users.map((user) => [user.email, user.id]));
  console.log(`Seeded ${users.length} users (password: "${SEED_PASSWORD}")`);

  const tasks = await Promise.all(SEED_TASKS.map(seedTask));
  const taskIdByTitle = new Map(tasks.map((task) => [task.title, task.id]));
  console.log(`Seeded ${tasks.length} tasks`);

  for (const routineSeed of SEED_ROUTINES) {
    await seedRoutine(routineSeed, userIdByEmail, taskIdByTitle);
  }
  console.log(`Seeded ${SEED_ROUTINES.length} routines`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
