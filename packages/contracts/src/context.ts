import { z } from 'zod';
import { isoInstant } from './primitives';

/**
 * The "contextual empathy" payload. This is the whole product thesis in one
 * object: everything here exists to answer "why haven't they replied?"
 * without the viewer having to ask.
 */

export const batteryStateSchema = z.enum(['unknown', 'unplugged', 'charging', 'full']);
export type BatteryState = z.infer<typeof batteryStateSchema>;

export const batteryContextSchema = z.object({
  /** 0-100. Rounded to 5% buckets before broadcast — see note below. */
  percent: z.number().int().min(0).max(100),
  state: batteryStateSchema,
  /** iOS Low Power Mode / Android battery saver. Strong "slow replies" signal. */
  powerSaving: z.boolean(),
});

export type BatteryContext = z.infer<typeof batteryContextSchema>;

/**
 * Battery is quantised to 5% before it leaves the device. A continuous
 * percentage is a surprisingly good side channel (it fingerprints a device
 * and leaks screen-on time), and the Battery Ring cannot render finer than
 * ~5% anyway at avatar size.
 */
export const BATTERY_QUANTUM = 5;

export const quantiseBattery = (percent: number): number =>
  Math.min(100, Math.max(0, Math.round(percent / BATTERY_QUANTUM) * BATTERY_QUANTUM));

/**
 * WMO weather codes (the Open-Meteo vocabulary). We keep the numeric code
 * rather than a string so the client owns the Lottie mapping and we can
 * restyle weather without a server deploy.
 */
export const weatherContextSchema = z.object({
  code: z.number().int().min(0).max(99),
  temperatureC: z.number().min(-90).max(60),
  isDay: z.boolean(),
  observedAt: isoInstant,
});

export type WeatherContext = z.infer<typeof weatherContextSchema>;

/** Coarse motion state, used to pick the avatar's idle animation. */
export const activitySchema = z.enum([
  'unknown',
  'still',
  'walking',
  'running',
  'cycling',
  'driving',
]);
export type Activity = z.infer<typeof activitySchema>;
