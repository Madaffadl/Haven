import type { ApiErrorBody, ApiErrorCode } from '@haven/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

/**
 * Every REST failure leaves the server as the same envelope (`apiErrorSchema`
 * in contracts), so the app has one place that turns errors into copy.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const rateLimited = (retryAfterMs: number): ApiError =>
  new ApiError(429, 'rate_limited', 'too many requests, slow down', retryAfterMs);

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'sign in again');

/** Validate with a contracts schema; anything malformed is the client's bug, not ours. */
export const parse = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'invalid_payload', 'malformed request');
  return result.data;
};

const body = (code: ApiErrorCode, message: string, retryAfterMs?: number): ApiErrorBody => ({
  error: { code, message, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
});

/** Install with `app.setErrorHandler`. */
export const errorHandler = (error: unknown, request: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof ApiError) {
    if (error.retryAfterMs !== undefined) {
      void reply.header('Retry-After', Math.ceil(error.retryAfterMs / 1000));
    }
    return reply.code(error.status).send(body(error.code, error.message, error.retryAfterMs));
  }

  // Fastify's own rejections (unparseable JSON, body too large) are 4xx and
  // safe to describe; anything else is ours and is not.
  const status = (error as { statusCode?: number }).statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    return reply.code(status).send(body('invalid_payload', (error as Error).message));
  }

  request.log.error({ err: error }, 'request failed');
  return reply.code(500).send(body('internal', 'something went wrong'));
};

/** Install with `app.setNotFoundHandler`. */
export const notFoundHandler = (_request: FastifyRequest, reply: FastifyReply) =>
  reply.code(404).send(body('not_found', 'no such route'));
