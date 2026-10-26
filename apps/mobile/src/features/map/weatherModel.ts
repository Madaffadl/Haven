import type { WeatherContext } from '@haven/contracts';

/**
 * WMO weather code → a small, closed set of glyphs.
 *
 * The server forwards the raw WMO code (Open-Meteo's vocabulary) so the
 * client owns the mapping and the art can change without a server deploy.
 * Collapsing ~28 codes into eight kinds is deliberate: at 22pt nobody can
 * tell "moderate drizzle" from "light rain", and a glyph that tries to is
 * noise on a map whose job is to be calm.
 */
export type WeatherKind =
  'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

export const weatherKind = (code: number): WeatherKind => {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  // Unknown codes degrade to the most neutral glyph rather than to a wrong one.
  return 'cloudy';
};

const SPOKEN: Record<WeatherKind, string> = {
  clear: 'clear skies',
  'partly-cloudy': 'partly cloudy',
  cloudy: 'cloudy',
  fog: 'foggy',
  drizzle: 'drizzling',
  rain: 'raining',
  snow: 'snowing',
  storm: 'thunderstorms',
};

export const weatherDescription = (weather: WeatherContext | undefined): string => {
  if (!weather) return 'weather unknown';
  const kind = weatherKind(weather.code);
  const sky = kind === 'clear' && !weather.isDay ? 'clear night' : SPOKEN[kind];
  return `${sky}, ${Math.round(weather.temperatureC)} degrees`;
};

/**
 * How much the glyph is allowed to move.
 *
 * The rule from the motion guidelines: one or two animated elements per view,
 * and no decorative infinite loops. A circle of eight with eight perpetually
 * raining clouds breaks both — and pays GPU time for it on a screen that is
 * often left open. So:
 *
 *   - 'loop'  only for the selected member, whose detail you are reading;
 *   - 'once'  when the weather actually changes, as a "this just updated" cue;
 *   - 'still' otherwise, and always under Reduce Motion.
 */
export type GlyphMotion = 'loop' | 'once' | 'still';

export const glyphMotion = (args: {
  selected: boolean;
  changedRecently: boolean;
  reduceMotion: boolean;
}): GlyphMotion => {
  if (args.reduceMotion) return 'still';
  if (args.selected) return 'loop';
  if (args.changedRecently) return 'once';
  return 'still';
};
