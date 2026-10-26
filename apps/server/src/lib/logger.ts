import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Coordinates are redacted at the logger, not at each call site.
 *
 * This is the last line of the containment strategy described in
 * docs/01-architecture.md §6.2: even if a precise position reaches a log
 * call by accident, it does not reach disk. A privacy product cannot have
 * its users' home addresses sitting in a log aggregator.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'coordinate',
      '*.coordinate',
      '*.*.coordinate',
      'precise',
      '*.precise',
      'report.coordinate',
      'geom',
      '*.geom',
    ],
    censor: '[redacted:location]',
  },
  base: { service: 'haven-server' },
});

export type Logger = typeof logger;
