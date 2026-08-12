import { Logger } from '@nestjs/common';
import type { InputGuardrail } from '@openai/agents';
import { meters } from '../../observability/metrics/meters';
import { SecurityEventLogger } from '../../observability/security-event.logger';

const logger = new Logger('RoutineCoachInputGuardrail');

// Deny-list: secrets/credentials, database/SQL internals, and common
// prompt-injection/other-user phrasing. Any match trips the guardrail
// regardless of what else is in the message.
const DENY_TERMS = [
  'password',
  'passwd',
  'secret',
  'api key',
  'apikey',
  'access token',
  'refresh token',
  'credential',
  'database',
  'db password',
  'sql',
  'drop table',
  'select *',
  'delete from',
  'prisma',
  'connection string',
  'env var',
  'environment variable',
  '.env',
  'root access',
  'ignore your instructions',
  'ignore previous instructions',
  'ignore all prior',
  'system prompt',
  'jailbreak',
  'other user',
  'another user',
  "someone else's",
  "everyone's email",
  'all users',
  'every user',
  'delete all',
  'delete every',
];

// Allow-list: on-topic guitar/practice/routine domain terms. At least one
// must be present for a request to be considered in-scope.
const ALLOW_TERMS = [
  'routine',
  'practice',
  'guitar',
  'task',
  'session',
  'exercise',
  'scale',
  'chord',
  'warm up',
  'warm-up',
  'warmup',
  'technique',
  'repertoire',
  'improvisation',
  'improv',
  'tempo',
  'metronome',
  'strum',
  'fret',
  'lesson',
  'song',
  'riff',
  'minute',
  'duration',
];

function extractText(input: string | unknown[]): string {
  return typeof input === 'string' ? input : JSON.stringify(input);
}

// Input guardrails are plain objects handed straight to `new Agent({...})`
// by RoutineCoachAgentFactory, not Nest-managed classes -- there is no
// constructor for Nest DI to inject into. SecurityEventLogger is instead
// threaded in as a build-time dependency via this factory, the same
// `build<Name>Tool(deps)` shape used by the five tool files, so the factory
// (which *is* an injectable, DI-resolved class) can supply the real
// singleton without this file reaching into Nest's container itself.
export function buildRoutineCoachInputGuardrail(
  securityEventLogger: SecurityEventLogger,
): InputGuardrail {
  return {
    name: 'RoutineCoachInputGuardrail',
    // Block until the check completes rather than running alongside the
    // model call -- the spec requires the agent operation to stop cleanly
    // before any tokens are spent or tools run.
    runInParallel: false,
    // Deliberately synchronous (heuristic keyword check, no LLM call) -- the
    // SDK's InputGuardrailFunction type still requires a Promise return,
    // hence the explicit Promise.resolve() below instead of `async`.
    execute: ({ input }) => {
      const text = extractText(input).toLowerCase();
      const matchedDenyTerm =
        DENY_TERMS.find((term) => text.includes(term)) ?? null;
      const isOnTopic = ALLOW_TERMS.some((term) => text.includes(term));
      const tripwireTriggered = Boolean(matchedDenyTerm) || !isOnTopic;

      if (tripwireTriggered) {
        logger.warn(
          `guardrail triggered (matchedDenyTerm=${matchedDenyTerm}, isOnTopic=${isOnTopic})`,
        );
        // Metadata only (matched deny *term*, on-topic flag) -- never the
        // raw user input/prompt text itself.
        meters.aiGuardrailTriggersTotal.add(1);
        securityEventLogger.log({
          eventType: 'ai.guardrail_triggered',
          outcome: 'triggered',
          detail: { matchedDenyTerm, isOnTopic },
        });
      }

      return Promise.resolve({
        tripwireTriggered,
        outputInfo: { matchedDenyTerm, isOnTopic },
      });
    },
  };
}
