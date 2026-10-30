import type { MemberPresence, MemberProfile } from '@haven/contracts';
import { ChevronLeft, EyeOff, MapPin, UserPlus } from 'lucide-react-native';
import { memo, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useNow } from '../../lib/useNow';
import { usePresence } from '../../state/presence';
import { selectAll } from '../../state/presenceReducer';
import { BottomSheet } from '../../ui/primitives/BottomSheet';
import { HText } from '../../ui/primitives/HText';
import { PressableScale } from '../../ui/primitives/PressableScale';
import { color, radius, size, space } from '../../ui/theme/tokens';
import { NudgeBar } from '../nudge/NudgeBar';
import { BatteryRing } from './BatteryRing';
import { WeatherGlyph } from './WeatherGlyph';
import { batteryDescription } from './batteryModel';
import {
  initialsColor,
  initialsOf,
  isStale,
  localTime,
  locationPhrase,
  nameOf,
  relativeAge,
} from './presenceCopy';
import { weatherDescription } from './weatherModel';

export const SHEET_LABELS = ['Collapsed', 'Half open', 'Expanded'] as const;

/** Peek shows the header only; half fits a member's detail; full fits the list. */
export const useSheetHeights = (): readonly number[] => {
  const { height } = useWindowDimensions();
  return useMemo(() => [132, Math.round(height * 0.46), Math.round(height * 0.88)], [height]);
};

const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface MemberSheetProps {
  circleId: string;
  /** You can't nudge yourself, so your own detail has no nudge bar. */
  selfId: string;
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
  index: number;
  onIndexChange: (index: number) => void;
  /** Omitted in demo mode, where there is no backend to invite into. */
  onInvite?: () => void;
}

/**
 * The sheet over the map: the circle at a glance, or one person in detail.
 *
 * It also lists everyone the map cannot show — ghost members have no
 * position, but they still have a battery, weather and a local time, and
 * that context is the point of the product. The list doubles as the
 * non-spatial way to reach any member, for people who cannot tap small
 * targets on a moving map.
 */
export const MemberSheet = ({
  circleId,
  selfId,
  selectedId,
  onSelect,
  index,
  onIndexChange,
  onInvite,
}: MemberSheetProps) => {
  const heights = useSheetHeights();
  const now = useNow();

  const members = usePresence(useShallow((s) => selectAll(s, circleId)));
  const profiles = usePresence((s) => s.circles[circleId]?.profiles);

  const selected = members.find((m) => m.userId === selectedId);
  const selectedProfile = selected ? profiles?.[selected.userId] : undefined;

  const online = members.filter((m) => m.online).length;

  const header = selected ? (
    <View>
      <HText variant="title" numberOfLines={1}>
        {nameOf(selectedProfile)}
      </HText>
      <HText variant="footnote" tone="secondary" numberOfLines={2}>
        {contextLine(selected, now)}
      </HText>
    </View>
  ) : (
    <View style={styles.headerRow}>
      <View style={styles.headerText}>
        <HText variant="title">Your circle</HText>
        <HText variant="footnote" tone="secondary" tabular>
          {/* An empty circle is the moment to invite, so say so instead of "1 of 1 online". */}
          {members.length <= 1 && onInvite
            ? 'Just you so far. Invite someone to see them here.'
            : `${online} of ${members.length} online`}
        </HText>
      </View>
      {onInvite ? (
        <PressableScale
          accessibilityLabel="Invite someone"
          onPress={onInvite}
          style={styles.inviteButton}
        >
          <UserPlus size={size.icon.md} color={color.text.onAccent} strokeWidth={2.25} />
        </PressableScale>
      ) : null}
    </View>
  );

  return (
    <BottomSheet
      snapHeights={heights}
      index={index}
      onIndexChange={onIndexChange}
      snapLabels={SHEET_LABELS}
      accessibilityLabel={selected ? `${nameOf(selectedProfile)} details` : 'Circle details'}
      header={header}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        // Content scrolls only once there is room to; at peek it is hidden
        // behind the fold and must not swallow touches meant for the map.
        scrollEnabled={index > 0}
      >
        {selected ? (
          <MemberDetail
            circleId={circleId}
            member={selected}
            profile={selectedProfile}
            isSelf={selected.userId === selfId}
            now={now}
            onBack={() => onSelect(null)}
          />
        ) : (
          members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              profile={profiles?.[member.userId]}
              now={now}
              onPress={() => onSelect(member.userId)}
            />
          ))
        )}
      </ScrollView>
    </BottomSheet>
  );
};

/** "Raining · 24° · 2:10 AM tomorrow there" — the whole thesis in one line. */
const contextLine = (member: MemberPresence, now: number): string => {
  const parts: string[] = [];
  if (member.battery) parts.push(`${member.battery.percent}%`);
  if (member.weather) parts.push(`${Math.round(member.weather.temperatureC)}°`);
  const local = localTime(member.timezone, now, VIEWER_TZ);
  if (local) parts.push(`${local.time}${local.dayHint ? ` ${local.dayHint}` : ''} there`);
  if (isStale(member.capturedAt, now)) parts.push(`seen ${relativeAge(member.capturedAt, now)}`);
  return parts.join(' · ') || 'No context yet';
};

// ---------------------------------------------------------------------------

interface MemberRowProps {
  member: MemberPresence;
  profile: MemberProfile | undefined;
  now: number;
  onPress: () => void;
}

const MemberRow = memo(({ member, profile, now, onPress }: MemberRowProps) => {
  const name = nameOf(profile);
  const accent = profile?.accentHex ?? color.accent.lavender;
  const hidden = member.coordinate === undefined;
  const TrailingIcon = member.trustMode === 'ghost' ? EyeOff : MapPin;

  return (
    <PressableScale
      accessibilityLabel={`${name}. ${batteryDescription(member.battery)}. ${locationPhrase(member)}`}
      accessibilityHint="Shows details"
      onPress={onPress}
      style={styles.row}
    >
      <View
        style={[
          styles.rowAvatar,
          { backgroundColor: accent },
          member.online ? null : styles.dimmed,
        ]}
      >
        <HText variant="footnote" scale="chrome" style={{ color: initialsColor(accent) }}>
          {initialsOf(name)}
        </HText>
      </View>

      <View style={styles.rowText}>
        <HText variant="body" numberOfLines={1}>
          {name}
        </HText>
        <HText variant="footnote" tone="secondary" numberOfLines={1} tabular>
          {contextLine(member, now)}
        </HText>
      </View>

      <TrailingIcon
        size={size.icon.md}
        // Hidden members' icon is the quieter tone: there is nothing on the
        // map to go to, so it should not look like a call to action.
        color={hidden ? color.text.tertiary : color.accent.mint}
        strokeWidth={2}
      />
    </PressableScale>
  );
});

MemberRow.displayName = 'MemberRow';

// ---------------------------------------------------------------------------

interface MemberDetailProps {
  circleId: string;
  member: MemberPresence;
  profile: MemberProfile | undefined;
  isSelf: boolean;
  now: number;
  onBack: () => void;
}

const MemberDetail = ({ circleId, member, profile, isSelf, now, onBack }: MemberDetailProps) => {
  const accent = profile?.accentHex ?? color.accent.lavender;
  const local = localTime(member.timezone, now, VIEWER_TZ);

  return (
    <View>
      {isSelf ? null : (
        <NudgeBar circleId={circleId} toUserId={member.userId} name={nameOf(profile)} />
      )}
      <View style={styles.tiles}>
        <Tile label="Battery" spoken={batteryDescription(member.battery)}>
          <BatteryRing battery={member.battery} accent={accent} size={56}>
            <HText variant="footnote" tabular scale="chrome">
              {member.battery ? `${member.battery.percent}` : '–'}
            </HText>
          </BatteryRing>
          <HText variant="footnote" tone="secondary">
            {member.battery?.powerSaving
              ? 'Low Power Mode'
              : member.battery?.state === 'charging'
                ? 'Charging'
                : ' '}
          </HText>
        </Tile>

        <Tile label="Weather" spoken={weatherDescription(member.weather)}>
          {member.weather ? (
            <>
              <WeatherGlyph weather={member.weather} motion="still" replayKey={0} />
              <HText variant="title" tabular>
                {`${Math.round(member.weather.temperatureC)}°`}
              </HText>
            </>
          ) : (
            <HText variant="body" tone="secondary">
              Unknown
            </HText>
          )}
        </Tile>

        <Tile
          label="Their time"
          spoken={local ? `${local.time}${local.dayHint ? `, ${local.dayHint}` : ''}` : 'unknown'}
        >
          <HText variant="title" tabular>
            {local?.time ?? '–'}
          </HText>
          <HText variant="footnote" tone="secondary">
            {local?.dayHint
              ? `${local.dayHint[0]?.toUpperCase()}${local.dayHint.slice(1)}`
              : 'Today'}
          </HText>
        </Tile>

        <Tile label="Location" spoken={locationPhrase(member)}>
          <HText variant="body" numberOfLines={2}>
            {locationPhrase(member).replace(/^./, (c) => c.toUpperCase())}
          </HText>
          <HText variant="footnote" tone="secondary" tabular>
            {relativeAge(member.capturedAt, now)}
          </HText>
        </Tile>
      </View>

      {/* Escape route: a visible way back that doesn't depend on dragging or
          tapping empty map. */}
      <PressableScale accessibilityLabel="Back to circle" onPress={onBack} style={styles.back}>
        <ChevronLeft size={size.icon.md} color={color.accent.peach} strokeWidth={2} />
        <HText variant="body" tone="peach">
          Circle
        </HText>
      </PressableScale>
    </View>
  );
};

interface TileProps {
  label: string;
  /** Single spoken summary; the tile's visual parts are not read separately. */
  spoken: string;
  children: ReactNode;
}

const Tile = ({ label, spoken, children }: TileProps) => (
  <View style={styles.tile} accessible accessibilityLabel={`${label}: ${spoken}`}>
    <HText variant="caption" tone="tertiary" style={styles.tileLabel}>
      {label.toUpperCase()}
    </HText>
    {children}
  </View>
);

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerText: { flex: 1 },
  inviteButton: {
    width: size.touchMin,
    height: size.touchMin,
    borderRadius: size.touchMin / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.peach,
  },
  scroll: { paddingTop: space.xs, gap: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xs,
    minHeight: 56,
  },
  rowAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  dimmed: { opacity: 0.55 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 112,
    padding: space.md,
    gap: space.xs,
    borderRadius: radius.md,
    // A faint lift inside the glass, not a second glass layer: nested blurs
    // cost frame time and muddy the material.
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.glass.border,
  },
  tileLabel: { letterSpacing: 0.8 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xxs,
    marginTop: space.md,
    paddingRight: space.sm,
  },
});
