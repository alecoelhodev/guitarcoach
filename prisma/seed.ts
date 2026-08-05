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
  referenceLink?: string;
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
  {
    title: "Bullet for My Valentine - 'Tears Don't Fall' main riff",
    category: 'technique',
    difficulty: 'medium',
    description:
      'Learn the main riff in Drop C# (C# G# C# F# A# D#). Focus on tight palm-muted eighth notes on the low C# string and clean power-chord shifts. Start around 60% tempo with a metronome.',
    referenceLink:
      'https://www.youtube.com/results?search_query=Bullet+For+My+Valentine+Tears+Dont+Fall',
  },
  {
    title: "Bullet for My Valentine - 'Hand of Blood' opening riff",
    category: 'technique',
    difficulty: 'medium',
    description:
      'Work the opening riff in Drop C#. Practice fast down-picked palm mutes and the pinch-harmonic accents; keep the picking hand relaxed to sustain speed.',
    referenceLink:
      'https://www.youtube.com/results?search_query=Bullet+For+My+Valentine+Hand+of+Blood',
  },
  {
    title: "Killswitch Engage - 'My Curse' main riff",
    category: 'repertoire',
    difficulty: 'hard',
    description:
      'Learn this riff in Drop C#. Focus on syncopated gallop rhythms and quick position shifts across the low strings; count the off-beats out loud while practicing.',
    referenceLink:
      'https://www.youtube.com/results?search_query=Killswitch+Engage+My+Curse',
  },
  {
    title: "All That Remains - 'This Calling' verse riff",
    category: 'technique',
    difficulty: 'hard',
    description:
      'Drill the verse riff in Drop C#. Emphasis on alternate-picking accuracy at speed and muting string noise between notes. Build tempo in 5 BPM increments.',
    referenceLink:
      'https://www.youtube.com/results?search_query=All+That+Remains+This+Calling',
  },
  {
    title: "As I Lay Dying - 'Nothing Left' intro riff",
    category: 'repertoire',
    difficulty: 'hard',
    description:
      'Learn the intro riff in Drop C#. Focus on chugging low-string rhythm locked to the kick pattern and clean transitions to the open C#.',
    referenceLink:
      'https://www.youtube.com/results?search_query=As+I+Lay+Dying+Nothing+Left',
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

interface SeedPracticeSession {
  userEmail: string;
  title: string;
  notes?: string;
}

const SEED_PRACTICE_SESSIONS: SeedPracticeSession[] = [
  {
    userEmail: 'admin@guitarcoach.dev',
    title: 'Morning warm-up session',
    notes: 'Focused on chromatic exercises and alternate picking.',
  },
  {
    userEmail: 'alice@guitarcoach.dev',
    title: 'Evening practice',
    notes: 'Worked through barre chord transitions.',
  },
  {
    userEmail: 'bob@guitarcoach.dev',
    title: 'Technique session',
  },
  {
    userEmail: 'carol@guitarcoach.dev',
    title: 'Weekend practice',
    notes: 'Ran through the 12-bar blues progression a few times.',
  },
  {
    userEmail: 'dave@guitarcoach.dev',
    title: 'Song study session',
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

async function seedPracticeSession(
  seed: SeedPracticeSession,
  userIdByEmail: Map<string, string>,
): Promise<void> {
  const userId = userIdByEmail.get(seed.userEmail);
  if (!userId) {
    throw new Error(
      `Seed data error: no seeded user for email "${seed.userEmail}"`,
    );
  }

  const existing = await prisma.practiceSession.findFirst({
    where: { userId, title: seed.title },
  });
  if (existing) {
    return;
  }

  await prisma.practiceSession.create({
    data: { userId, title: seed.title, notes: seed.notes },
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

  for (const practiceSessionSeed of SEED_PRACTICE_SESSIONS) {
    await seedPracticeSession(practiceSessionSeed, userIdByEmail);
  }
  console.log(`Seeded ${SEED_PRACTICE_SESSIONS.length} practice sessions`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
