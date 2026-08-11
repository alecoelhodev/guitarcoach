-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN     "routine_id" UUID;

-- CreateTable
CREATE TABLE "practice_session_tasks" (
    "practice_session_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "duration_minutes" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_session_tasks_pkey" PRIMARY KEY ("practice_session_id","task_id")
);

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_session_tasks" ADD CONSTRAINT "practice_session_tasks_practice_session_id_fkey" FOREIGN KEY ("practice_session_id") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_session_tasks" ADD CONSTRAINT "practice_session_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
