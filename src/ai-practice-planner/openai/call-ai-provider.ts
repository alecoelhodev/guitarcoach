import {
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';

/**
 * Runs one provider call and maps OpenAI's failures to HTTP: a timeout to 504, and rate
 * limits, outages and any other API error to 503 with `unavailableMessage`. Anything that
 * isn't an OpenAI error (a validation failure, a 502 for a malformed reply) passes through.
 */
export async function callAiProvider<T>(
  fn: () => Promise<T>,
  unavailableMessage: string,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      throw new GatewayTimeoutException('OpenAI request timed out');
    }
    // APIConnectionTimeoutError, RateLimitError and InternalServerError all extend
    // APIError, so this also covers APIConnectionError and the rest of the hierarchy.
    if (error instanceof OpenAI.APIError) {
      throw new ServiceUnavailableException(unavailableMessage);
    }
    throw error;
  }
}
