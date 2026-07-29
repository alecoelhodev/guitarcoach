-- CreateEnum
CREATE TYPE "task_category" AS ENUM ('technique', 'theory', 'repertoire');

-- CreateEnum
CREATE TYPE "task_difficulty" AS ENUM ('easy', 'medium', 'hard');

-- AlterTable
ALTER TABLE "tasks"
  ALTER COLUMN "category" TYPE "task_category" USING ("category"::"task_category"),
  ALTER COLUMN "difficulty" TYPE "task_difficulty" USING ("difficulty"::"task_difficulty");
