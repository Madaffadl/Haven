import Mapbox, {
  Camera,
  FillLayer,
  LineLayer,
  MapView,
  MarkerView,
  ShapeSource,
  StyleImport,
} from '@rnmapbox/maps';
import type { TrustMode } from '@haven/contracts';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';

import { useNow } from '../../lib/useNow';
import { usePresence } from '../../state/presence';
import { selectMappable, type MappableMember } from '../../state/presenceReducer';
import { color, size } from '../../ui/theme/tokens';
import { AvatarMarker } from './AvatarMarker';
import { MIN_VISIBLE_ACCURACY_M, boundsFor, circlePolygon, fanOutGroups } from './geometry';
import { STANDARD_STYLE_URL, havenMapConfig } from './mapStyle';

const extra = Constants.expoConfig?.extra as { mapboxToken?: string } | undefined;

void Mapbox.setAccessToken(extra?.mapboxToken ?? '');

// Dot notation is required: Expo inlines EXPO_PUBLIC_* at build time only
// when accessed statically. `process.env['…']` would always be undefined.
const CUSTOM_STYLE_URL = process.env.EXPO_PUBLIC_MAPBOX_STYLE_URL;

type CameraHandle = ComponentRef<typeof Camera>;

/** Camera moves are short and decelerating; they arrive, they don't wander. */
const CAMERA_MS = 650;

interface LiveContextMapProps {
  circleId: string;
  selfId: string;
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  /**
   * Height of the sheet currently covering the bottom of the map. The camera
   * pads by it, so a selected avatar is centred in the *visible* map rather
   * than hidden behind the glass.
   */
  bottomInset: number;
  /** Badged on your own marker; see AvatarMarker. */
  selfTrustMode: TrustMode;
}

type FuzzFeature = GeoJSON.Feature<GeoJSON.Polygon, { mode: 'approximate' | 'precise' }>;

/**
 * Radius discs, drawn natively as one ShapeSource.
 *
 * Approximate members get a lavender disc with a DASHED edge, precise ones a
 * solid mint ring. The dash is the non-colour cue: "this is an area, not a
 * point" survives greyscale and colour-blindness.
 */
const discFeatures = (members: readonly MappableMember[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: members.flatMap((m): FuzzFeature[] => {
    const radius = m.radiusM ?? 0;
    const mode = m.trustMode === 'approximate' ? 'approximate' : 'precise';
    // A precise ring tighter than the avatar would be invisible clutter.
    if (mode === 'precise' && radius < MIN_VISIBLE_ACCURACY_M) return [];
    return [
      {
        type: 'Feature',
        id: m.userId,
        properties: { mode },
        geometry: { type: 'Polygon', coordinates: [circlePolygon(m.coordinate, radius)] },
      },
    ];
  }),
});

/**
 * The Live Context Map.
 *
 * Renders only what the server sent and the client store kept — ghost members
 * never reach `selectMappable`, and members quarantined by a Trust Mode change
 * have no coordinate to draw. The map has no way to show a position it was
 * told to forget.
 */
export const LiveContextMap = ({
  circleId,
  selfId,
  selectedId,
  onSelect,
  bottomInset,
  selfTrustMode,
}: LiveContextMapProps) => {
  const camera = useRef<CameraHandle>(null);
  const reduceMotion = useReducedMotion();
  const now = useNow();

  // useShallow: selectMappable builds a new array each call; comparing its
  // elements by reference keeps an unrelated circle's update from
  // re-rendering this map.
  const members = usePresence(useShallow((s) => selectMappable(s, circleId)));
  const profiles = usePresence((s) => s.circles[circleId]?.profiles);

  const groups = useMemo(() => fanOutGroups(members), [members]);
  const discs = useMemo(() => discFeatures(members), [members]);

  const duration = reduceMotion ? 0 : CAMERA_MS;
  const padding = useMemo(
    () => ({
      paddingTop: 96,
      paddingBottom: bottomInset + 48,
      paddingLeft: 48,
      paddingRight: 48,
    }),
    [bottomInset],
  );

  // Frame everyone once, when the circle first has positions to show and the
  // map can take a camera command. Positions can arrive first (the demo
  // circle does, synchronously), and a fitBounds sent before the native map
  // has loaded is silently dropped, leaving the camera on the default globe.
  const [mapLoaded, setMapLoaded] = useState(false);
  const framed = useRef(false);
  useEffect(() => {
    if (!mapLoaded || framed.current || members.length === 0) return;
    const bounds = boundsFor(members.map((m) => m.coordinate));
    if (!bounds) return;
    framed.current = true;
    camera.current?.fitBounds(
      bounds.ne,
      bounds.sw,
      [padding.paddingTop, padding.paddingRight, padding.paddingBottom, padding.paddingLeft],
      duration,
    );
  }, [mapLoaded, members, padding, duration]);

  // Follow the selection.
  const selected = members.find((m) => m.userId === selectedId);
  const selectedCoordinate = selected?.coordinate;
  useEffect(() => {
    if (!selectedCoordinate) return;
    camera.current?.setCamera({
      centerCoordinate: selectedCoordinate,
      padding,
      animationDuration: duration,
      animationMode: 'easeTo',
    });
    // Coordinates as primitives: re-centre when they move, not on every render.
  }, [selectedCoordinate?.[0], selectedCoordinate?.[1], padding, duration]);

  const handleSelect = useCallback((userId: string) => onSelect(userId), [onSelect]);

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      styleURL={CUSTOM_STYLE_URL ?? STANDARD_STYLE_URL}
      // North-up, flat: a calm map you read at a glance, not one you fly.
      pitchEnabled={false}
      rotateEnabled={false}
      compassEnabled={false}
      scaleBarEnabled={false}
      // Logo and attribution are required by the Mapbox terms. They stay, and
      // are lifted above the sheet so the glass never covers them.
      logoEnabled
      attributionEnabled
      logoPosition={{ bottom: bottomInset + 8, left: 12 }}
      attributionPosition={{ bottom: bottomInset + 8, right: 12 }}
      onPress={() => onSelect(null)}
      onDidFinishLoadingMap={() => setMapLoaded(true)}
    >
      {CUSTOM_STYLE_URL ? null : <StyleImport id="basemap" existing config={havenMapConfig} />}

      <Camera ref={camera} />

      {/* Emissive strength 1 on every disc layer: Standard's `night` light
          preset darkens added layers like the rest of the map, which turned
          the lavender Approximate disc into a near-invisible dark smudge.
          Emissive layers keep the token colours the contrast tests check. */}
      <ShapeSource id="presence-discs" shape={discs}>
        <FillLayer
          id="presence-disc-fill"
          style={{
            fillColor: [
              'match',
              ['get', 'mode'],
              'approximate',
              color.map.approximateFill,
              color.map.preciseFill,
            ],
            fillEmissiveStrength: 1,
          }}
        />
        <LineLayer
          id="presence-disc-edge-approximate"
          filter={['==', ['get', 'mode'], 'approximate']}
          style={{
            lineColor: color.map.approximateStroke,
            lineWidth: 1.5,
            lineDasharray: [2, 2],
            lineEmissiveStrength: 1,
          }}
        />
        <LineLayer
          id="presence-disc-edge-precise"
          filter={['==', ['get', 'mode'], 'precise']}
          style={{ lineColor: color.map.preciseStroke, lineWidth: 1, lineEmissiveStrength: 1 }}
        />
      </ShapeSource>

      {/* One marker per group of people at the same spot, avatars laid out
          inside it (geometry.ts fanOutGroups). The anchor stays the centre,
          inside the [0, 1] range MarkerView requires. A lone member's group
          is exactly one marker wide, as before. */}
      {groups.map(({ anchor, members: placed }) => {
        const reachX = Math.max(...placed.map(({ offset }) => Math.abs(offset.dx)));
        const reachY = Math.max(...placed.map(({ offset }) => Math.abs(offset.dy)));
        const width = size.marker + 2 * reachX;
        const height = size.marker + 2 * reachY;
        const hasSelection = placed.some(({ member }) => member.userId === selectedId);

        return (
          <MarkerView
            key={placed.map(({ member }) => member.userId).join(':')}
            coordinate={anchor}
            allowOverlap
            allowZElevate
            isSelected={hasSelection}
            stopGesturePropagation
          >
            <View style={{ width, height }}>
              {placed.map(({ member, offset }) => (
                <View
                  key={member.userId}
                  style={{
                    position: 'absolute',
                    left: (width - size.marker) / 2 + offset.dx,
                    top: (height - size.marker) / 2 + offset.dy,
                  }}
                >
                  <AvatarMarker
                    member={member}
                    profile={profiles?.[member.userId]}
                    selected={member.userId === selectedId}
                    isSelf={member.userId === selfId}
                    selfTrustMode={selfTrustMode}
                    now={now}
                    onPress={handleSelect}
                  />
                </View>
              ))}
            </View>
          </MarkerView>
        );
      })}
    </MapView>
  );
};
