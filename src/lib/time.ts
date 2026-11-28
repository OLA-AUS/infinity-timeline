// Where things sit in 3D space. Converts years into distances along the river.
//
// Time is log-scaled: the further back you go, the more each step of the river is
// squeezed. That lets 5,000 years fit on screen while recent decades still get room.
// "s" in this file means "distance along the river" — bigger s = more recent.
import type { Field, SpaceTag, Year } from '../types';
import { FIELDS } from '../types';

const ANCHOR = 2031; // a few years after "now" so the present isn't infinitely stretched
const TOP = 3.8; // log10 of the oldest span we draw (≈ 6,300 years before ANCHOR)
const SCALE = 100; // world units per factor-of-ten in time

/** Year → distance along the river. */
export const yearToS = (year: Year) => (TOP - Math.log10(Math.max(1, ANCHOR - year))) * SCALE;
/** Distance along the river → year (the inverse of yearToS). */
export const sToYear = (s: number): Year => ANCHOR - Math.pow(10, TOP - s / SCALE);

/** The ends of the river you can travel between. */
export const S_MIN = yearToS(-3500);
export const S_MAX = yearToS(2027);

/** Gentle side-to-side meander of the river, so it doesn't look like a ruler. */
export const riverX = (s: number) => Math.sin(s * 0.03) * 6;

/** Sideways offset of each field's lane from the river's centre line. */
export const laneOffset = (field: Field) => (FIELDS.indexOf(field) - (FIELDS.length - 1) / 2) * 2.2;

/**
 * Personal spaces run in their own lanes alongside the main river, on its right bank:
 * the first starts a little beyond the last field lane, then one every PERSONAL_LANE_GAP.
 */
export const PERSONAL_LANE_START = 9.2;
export const PERSONAL_LANE_GAP = 2.4;
export const personalLaneOffset = (lane: number) => PERSONAL_LANE_START + lane * PERSONAL_LANE_GAP;

/** Where an event or person sits sideways: its field's lane, or its personal space's lane. */
export const laneX = (item: { field: Field; space?: SpaceTag }) => (item.space ? personalLaneOffset(item.space.lane) : laneOffset(item.field));

/** An event's or person's colour: its field's colour, or its personal space's. */
export const colorOf = (item: { field: Field; space?: SpaceTag }) => item.space?.color ?? FIELD_COLOR[item.field];

/** 3D point for a year in a lane. The river runs away from the camera along −z. */
export const position = (year: Year, field: Field, y = 0): [number, number, number] => {
  const s = yearToS(year);
  return [riverX(s) + laneOffset(field), y, -s];
};

/** One colour per lane, used for lines, event spheres and legends. */
export const FIELD_COLOR: Record<Field, string> = {
  politics: '#ff7a59',
  science: '#5cc8ff',
  medicine: '#3ddc97',
  economics: '#f5b83d',
  technology: '#b48cff',
  culture: '#ff6fb5',
};

// Year formatting lives with the other date helpers; re-exported here so older imports keep working.
export { formatYear } from './dates';
