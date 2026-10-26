import type { StyleImport } from '@rnmapbox/maps';
import type { ComponentProps } from 'react';

import { mapBackdrop, palette } from '../../ui/theme/tokens';

/**
 * Haven's map: Mapbox Standard, recoloured into the app palette in code.
 *
 * The brief asks for a muted dark map with POIs and unnecessary labels
 * removed, so the avatars are the only thing competing for attention. Doing
 * that through Standard's config, instead of a hand-built Studio style:
 *   - keeps the map colours in the same token system as everything else;
 *   - lets the road colour be *exactly* `mapBackdrop.brightest`, the colour
 *     test/tokens.test.ts verifies every glass surface against — so the
 *     contrast proof and the shipped map cannot drift apart;
 *   - inherits Mapbox's ongoing Standard improvements for free.
 *
 * Set EXPO_PUBLIC_MAPBOX_STYLE_URL to swap in a Studio style instead.
 */

export const STANDARD_STYLE_URL = 'mapbox://styles/mapbox/standard';

type StandardConfig = ComponentProps<typeof StyleImport>['config'];

export const havenMapConfig: StandardConfig = {
  // `night` applies Standard's own dusk lighting on top of our colours, which
  // only darkens them — contrast against the tested backdrop can only improve.
  lightPreset: 'night',
  theme: 'faded',

  colorLand: mapBackdrop.darkest,
  colorWater: palette.navy900,
  colorGreenspaces: palette.navy900,
  colorRoads: mapBackdrop.brightest,
  colorMotorways: mapBackdrop.brightest,
  colorBoundaries: palette.navy700,

  // Neighbourhood and city names stay: they are the context that makes an
  // Approximate disc meaningful ("somewhere in Kemang"). Everything else goes.
  showPlaceLabels: true,
  showRoadLabels: false,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showPedestrianRoads: false,

  // 3D buildings and trees are the most GPU-expensive layers in Standard, and
  // they would occlude avatars at street zoom. Off, for clarity and battery.
  show3dObjects: false,
  show3dBuildings: false,
  show3dFacades: false,
  show3dLandmarks: false,
  show3dTrees: false,
};
