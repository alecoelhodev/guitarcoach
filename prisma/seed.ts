// Development seed data: 5 users (1 admin + 4 regular), 20 tasks, 2 routines
// per user (one archived for status variety), and several practice sessions
// per user spread across the last ~5 weeks, most with linked
// PracticeSessionTask rows and some linked back to a routine. Safe to
// re-run — every entity is looked up by its natural key first and left
// untouched if it already exists.
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
  {
    title: 'Travis picking fingerstyle pattern',
    category: 'technique',
    difficulty: 'medium',
    description:
      'Build a steady alternating-bass Travis picking pattern. Start with a static chord shape before moving the bass line under a chord progression.',
  },
  {
    title: 'Interval and chord-quality ear training',
    category: 'theory',
    difficulty: 'medium',
    description:
      'Drill recognizing intervals and major/minor/diminished/augmented triads by ear before checking against the fretboard.',
  },
  {
    title: 'Sight-reading rhythm notation',
    category: 'theory',
    difficulty: 'medium',
    description:
      'Clap or tap through rhythm-only notation (no pitches) to build reading fluency independent of fretboard position.',
  },
  {
    title: 'String-skipping arpeggio patterns',
    category: 'technique',
    difficulty: 'hard',
    description:
      'Practice arpeggio shapes that skip non-adjacent strings, muting the skipped string cleanly with the picking hand.',
  },
  {
    title: 'Learn a second full song from tab',
    category: 'repertoire',
    difficulty: 'medium',
    description:
      'Pick a song outside your usual genre and learn it end to end, including any solo or lead section.',
  },
];

interface SeedRoutine {
  userEmail: string;
  title: string;
  taskTitles: string[];
  status?: 'active' | 'archived';
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
    userEmail: 'admin@guitarcoach.dev',
    title: 'Admin theory deep-dive (retired)',
    taskTitles: [
      'Interval and chord-quality ear training',
      'Modes of the major scale',
    ],
    status: 'archived',
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
    userEmail: 'alice@guitarcoach.dev',
    title: "Alice's fingerstyle focus",
    taskTitles: [
      'Travis picking fingerstyle pattern',
      'Sight-reading rhythm notation',
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
    userEmail: 'bob@guitarcoach.dev',
    title: "Bob's old metal riff rotation (retired)",
    taskTitles: [
      "Bullet for My Valentine - 'Tears Don't Fall' main riff",
      "Killswitch Engage - 'My Curse' main riff",
    ],
    status: 'archived',
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
    userEmail: 'carol@guitarcoach.dev',
    title: "Carol's ear training block",
    taskTitles: ['Interval and chord-quality ear training', 'Circle of fifths'],
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
  {
    userEmail: 'dave@guitarcoach.dev',
    title: "Dave's metal riff rotation",
    taskTitles: [
      "All That Remains - 'This Calling' verse riff",
      "As I Lay Dying - 'Nothing Left' intro riff",
      'String-skipping arpeggio patterns',
    ],
  },
];

interface SeedPracticeSessionTask {
  taskTitle: string;
  durationMinutes?: number;
  completed?: boolean;
}

interface SeedPracticeSession {
  userEmail: string;
  title: string;
  notes?: string;
  // How many days before "now" this session happened -- gives seeded data a
  // realistic recency spread so recent-vs-all-time tool logic (e.g.
  // PracticeSessionsService.getTaskStats) has something real to distinguish.
  daysAgo: number;
  // Optional link to one of that user's SEED_ROUTINES titles; omitted for
  // freeform practice not following a routine.
  routineTitle?: string;
  tasks?: SeedPracticeSessionTask[];
}

const SEED_PRACTICE_SESSIONS: SeedPracticeSession[] = [
  // admin
  {
    userEmail: 'admin@guitarcoach.dev',
    title: 'Morning warm-up and picking drills',
    notes: 'Focused on chromatic exercises and alternate picking.',
    daysAgo: 1,
    routineTitle: 'Admin daily practice',
    tasks: [
      { taskTitle: 'Chromatic finger warm-up', durationMinutes: 10 },
      { taskTitle: 'Alternate picking drills', durationMinutes: 20 },
    ],
  },
  {
    userEmail: 'admin@guitarcoach.dev',
    title: 'Quick theory review',
    daysAgo: 4,
    tasks: [
      { taskTitle: 'Circle of fifths', durationMinutes: 15, completed: true },
    ],
  },
  {
    userEmail: 'admin@guitarcoach.dev',
    title: 'Old ear-training block',
    notes: 'Revisited the archived theory routine.',
    daysAgo: 22,
    routineTitle: 'Admin theory deep-dive (retired)',
    tasks: [
      {
        taskTitle: 'Interval and chord-quality ear training',
        durationMinutes: 25,
      },
      { taskTitle: 'Modes of the major scale', durationMinutes: 20 },
    ],
  },
  // alice
  {
    userEmail: 'alice@guitarcoach.dev',
    title: 'Evening barre chord practice',
    notes: 'Worked through barre chord transitions.',
    daysAgo: 2,
    routineTitle: "Alice's warm-up routine",
    tasks: [
      { taskTitle: 'Barre chord transitions', durationMinutes: 15 },
      {
        taskTitle: 'Learn a 12-bar blues progression',
        durationMinutes: 20,
        completed: false,
      },
    ],
  },
  {
    userEmail: 'alice@guitarcoach.dev',
    title: 'Fingerstyle practice',
    daysAgo: 6,
    routineTitle: "Alice's fingerstyle focus",
    tasks: [
      { taskTitle: 'Travis picking fingerstyle pattern', durationMinutes: 20 },
    ],
  },
  {
    userEmail: 'alice@guitarcoach.dev',
    title: 'Rhythm reading catch-up',
    daysAgo: 33,
    tasks: [
      { taskTitle: 'Sight-reading rhythm notation', durationMinutes: 15 },
    ],
  },
  // bob
  {
    userEmail: 'bob@guitarcoach.dev',
    title: 'Sweep picking technique session',
    daysAgo: 3,
    routineTitle: "Bob's technique builder",
    tasks: [
      { taskTitle: 'Sweep picking arpeggios', durationMinutes: 25 },
      { taskTitle: 'Chromatic finger warm-up', durationMinutes: 10 },
    ],
  },
  {
    userEmail: 'bob@guitarcoach.dev',
    title: 'Metal riff throwback',
    notes: 'Dusted off the old riff rotation.',
    daysAgo: 35,
    routineTitle: "Bob's old metal riff rotation (retired)",
    tasks: [
      {
        taskTitle: "Bullet for My Valentine - 'Tears Don't Fall' main riff",
        durationMinutes: 20,
      },
      {
        taskTitle: "Killswitch Engage - 'My Curse' main riff",
        durationMinutes: 20,
        completed: false,
      },
    ],
  },
  {
    userEmail: 'bob@guitarcoach.dev',
    title: 'Quick warm-up',
    daysAgo: 10,
    tasks: [{ taskTitle: 'Chromatic finger warm-up', durationMinutes: 10 }],
  },
  // carol
  {
    userEmail: 'carol@guitarcoach.dev',
    title: 'Weekend blues practice',
    notes: 'Ran through the 12-bar blues progression a few times.',
    daysAgo: 1,
    routineTitle: "Carol's practice plan",
    tasks: [
      {
        taskTitle: 'Learn a full song from tab',
        durationMinutes: 30,
      },
      { taskTitle: 'Alternate picking drills', durationMinutes: 15 },
    ],
  },
  {
    userEmail: 'carol@guitarcoach.dev',
    title: 'Ear training drill',
    daysAgo: 8,
    routineTitle: "Carol's ear training block",
    tasks: [
      {
        taskTitle: 'Interval and chord-quality ear training',
        durationMinutes: 20,
      },
    ],
  },
  {
    userEmail: 'carol@guitarcoach.dev',
    title: 'Barre chord cleanup',
    daysAgo: 27,
    tasks: [
      {
        taskTitle: 'Barre chord transitions',
        durationMinutes: 15,
        completed: false,
      },
    ],
  },
  // dave
  {
    userEmail: 'dave@guitarcoach.dev',
    title: 'Full song study session',
    daysAgo: 2,
    routineTitle: "Dave's session",
    tasks: [
      { taskTitle: 'Learn a full song from tab', durationMinutes: 30 },
      { taskTitle: 'Intervals and triads', durationMinutes: 15 },
    ],
  },
  {
    userEmail: 'dave@guitarcoach.dev',
    title: 'Metal riff rotation run-through',
    daysAgo: 5,
    routineTitle: "Dave's metal riff rotation",
    tasks: [
      {
        taskTitle: "All That Remains - 'This Calling' verse riff",
        durationMinutes: 20,
      },
      {
        taskTitle: "As I Lay Dying - 'Nothing Left' intro riff",
        durationMinutes: 20,
      },
      { taskTitle: 'String-skipping arpeggio patterns', durationMinutes: 15 },
    ],
  },
  {
    userEmail: 'dave@guitarcoach.dev',
    title: 'Second-song study',
    daysAgo: 20,
    tasks: [
      {
        taskTitle: 'Learn a second full song from tab',
        durationMinutes: 30,
        completed: false,
      },
    ],
  },
];

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set. Add it to .env (see .env.example).');
}

const prisma = new PrismaService();
const auth = createAuth(
  prisma,
  new RedisRateLimitStorage(process.env.REDIS_URL),
);

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

// Returns the routine's id, keyed by userEmail+title in main() so practice
// sessions can look up which routine (if any) they followed.
async function seedRoutine(
  seed: SeedRoutine,
  userIdByEmail: Map<string, string>,
  taskIdByTitle: Map<string, string>,
): Promise<string> {
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
    return existing.id;
  }

  const routine = await prisma.routine.create({
    data: { userId, title: seed.title, status: seed.status ?? 'active' },
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

  return routine.id;
}

async function seedPracticeSession(
  seed: SeedPracticeSession,
  userIdByEmail: Map<string, string>,
  taskIdByTitle: Map<string, string>,
  routineIdByKey: Map<string, string>,
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

  let routineId: string | undefined;
  if (seed.routineTitle) {
    routineId = routineIdByKey.get(`${seed.userEmail}::${seed.routineTitle}`);
    if (!routineId) {
      throw new Error(
        `Seed data error: no seeded routine titled "${seed.routineTitle}" for "${seed.userEmail}"`,
      );
    }
  }

  await prisma.practiceSession.create({
    data: {
      userId,
      title: seed.title,
      notes: seed.notes,
      routineId,
      createdAt: new Date(Date.now() - seed.daysAgo * 24 * 60 * 60 * 1000),
      sessionTasks: seed.tasks
        ? {
            create: seed.tasks.map((sessionTask) => {
              const taskId = taskIdByTitle.get(sessionTask.taskTitle);
              if (!taskId) {
                throw new Error(
                  `Seed data error: no seeded task titled "${sessionTask.taskTitle}"`,
                );
              }
              return {
                taskId,
                durationMinutes: sessionTask.durationMinutes,
                completed: sessionTask.completed ?? true,
              };
            }),
          }
        : undefined,
    },
  });
}

async function main(): Promise<void> {
  const users = await Promise.all(SEED_USERS.map(seedUser));
  const userIdByEmail = new Map(users.map((user) => [user.email, user.id]));
  console.log(`Seeded ${users.length} users (password: "${SEED_PASSWORD}")`);

  const tasks = await Promise.all(SEED_TASKS.map(seedTask));
  const taskIdByTitle = new Map(tasks.map((task) => [task.title, task.id]));
  console.log(`Seeded ${tasks.length} tasks`);

  const routineIdByKey = new Map<string, string>();
  for (const routineSeed of SEED_ROUTINES) {
    const routineId = await seedRoutine(
      routineSeed,
      userIdByEmail,
      taskIdByTitle,
    );
    routineIdByKey.set(
      `${routineSeed.userEmail}::${routineSeed.title}`,
      routineId,
    );
  }
  console.log(`Seeded ${SEED_ROUTINES.length} routines`);

  for (const practiceSessionSeed of SEED_PRACTICE_SESSIONS) {
    await seedPracticeSession(
      practiceSessionSeed,
      userIdByEmail,
      taskIdByTitle,
      routineIdByKey,
    );
  }
  console.log(`Seeded ${SEED_PRACTICE_SESSIONS.length} practice sessions`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
