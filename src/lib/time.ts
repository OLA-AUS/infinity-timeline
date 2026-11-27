// Log-scaled time so deep history compresses and recent decades get room.
import type { Field, Year } from '../types';
import { FIELDS } from '../types';

const ANCHOR = 2031; // a few years after "now" so the present isn't infinitely stretched
const TOP = 3.8;
const SCALE = 100;

export const yearToS = (year: Year) => (TOP - Math.log10(Math.max(1, ANCHOR - year))) * SCALE;
export const sToYear = (s: number): Year => ANCHOR - Math.pow(10, TOP - s / SCALE);

export const S_MIN = yearToS(-3500);
export const S_MAX = yearToS(2027);

/** Gentle meander of the river. */
export const riverX = (s: number) => Math.sin(s * 0.03) * 6;

export const laneOffset = (field: Field) => (FIELDS.indexOf(field) - (FIELDS.length - 1) / 2) * 2.2;

export const position = (year: Year, field: Field, y = 0): [number, number, number] => {
  const s = yearToS(year);
  return [riverX(s) + laneOffset(field), y, -s];
};

export const FIELD_COLOR: Record<Field, string> = {
  politics: '#ff7a59',
  science: '#5cc8ff',
  medicine: '#3ddc97',
  economics: '#f5b83d',
  technology: '#b48cff',
  culture: '#ff6fb5',
};

export function formatYear(y: Year): string {
  const r = Math.floor(y);
  return r < 0 ? `${-r} BCE` : `${r}`;
}
