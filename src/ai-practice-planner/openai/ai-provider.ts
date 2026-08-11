import { PracticePlan } from '../dto/practice-plan.schema';
import { CreateRoutineResult } from '../tools/create-routine.types';

export interface GeneratedPracticePlan {
  plan: PracticePlan;
  previousResponseId: string;
}

export interface ConfirmedRoutineCreation {
  finalMessage: string;
  toolResult: CreateRoutineResult;
}

// `unknown`, not CreateRoutineArgs: even though the OpenAI SDK's
// zodResponsesFunction() helper already validates the shape before handing
// back parsed_arguments, the executor (CreateRoutineTool.execute) must not
// assume that guarantee holds -- it re-validates independently with
// CreateRoutineArgsSchema.safeParse(). This is what "do not trust model
// output without application-side validation" means at the type level, not
// just at the runtime level.
export type CreateRoutineExecutor = (
  args: unknown,
) => Promise<CreateRoutineResult>;

// Thin seam over the OpenAI Responses API so ai-practice-planner.service.ts
// never touches the `openai` SDK directly. Implemented by
// OpenAiResponsesService; swapped for a FakeAiProvider in e2e tests the same
// way GcpStorageService/ROUTINE_EVENTS_CLIENT are swapped in
// test/support/build-test-app.ts.
export interface AiProvider {
  // Runs the structured-output planning turn (web_search enabled, no
  // create_routine tool -- the model architecturally cannot persist
  // anything from this call). Throws on OpenAI failure; callers validate
  // the returned plan with assertValidPracticePlan.
  generatePracticePlan(prompt: string): Promise<GeneratedPracticePlan>;

  // Continues the conversation identified by previousResponseId with the
  // create_routine tool available, expects exactly one function_call to
  // create_routine, invokes executeCreateRoutine with the parsed+validated
  // arguments, and submits the result back as a function_call_output to get
  // the model's final acknowledgment text.
  confirmAndCreateRoutine(
    previousResponseId: string,
    executeCreateRoutine: CreateRoutineExecutor,
  ): Promise<ConfirmedRoutineCreation>;
}
