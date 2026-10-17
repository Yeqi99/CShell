import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'OVERLOADED'
  | 'CANCELLED'
  | 'DEADLINE_EXCEEDED'
  | 'UNAVAILABLE'
  | 'CURSOR_EXPIRED'
  | 'BUDGET_TOO_SMALL'
  | 'EXECUTION_FAILED'
  | 'OUTCOME_UNKNOWN';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly nextAction: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function apiFailure(error: unknown) {
  if (error instanceof ZodError)
    return {
      code: 'INVALID_ARGUMENT',
      message: 'Input does not match the operation schema.',
      nextAction: 'Read the current complete contract and correct the input before retrying.',
    };
  if (error instanceof ApiError)
    return {
      code: error.code,
      message: error.message,
      nextAction: error.nextAction,
      details: error.details,
    };
  return {
    code: 'EXECUTION_FAILED',
    message: 'The operation failed. Its effects may be incomplete.',
    nextAction: 'Inspect the task or target state before retrying a mutation.',
  };
}
