export const UNIT_FACTOR = { g: 1, kg: 1000, ml: 1, l: 1000, piece: 1, packet: 1, other: 1 };

export function toBase(q, unit) {
  return Number(q || 0) * (UNIT_FACTOR[unit] ?? 1);
}

export function normalizeRate(rate, rateUnit, quantityUnit) {
  const r = Number(rate || 0);
  const rf = UNIT_FACTOR[rateUnit] ?? 1;
  const qf = UNIT_FACTOR[quantityUnit] ?? 1;
  return r * (qf / rf);
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Date inputs are calendar dates. Using noon avoids the UTC-midnight shift
// that can move an entered date to the previous day in India.
export function parseDateInput(value) {
  if (!value) return new Date();
  const [y, m, day] = String(value).split('-').map(Number);
  if (!y || !m || !day) return new Date(value);
  return new Date(y, m - 1, day, 12, 0, 0, 0);
}

export function dateRange(type, from, to) {
  const now = new Date();
  let a, b;
  if (type === 'today') {
    a = startOfDay(now); b = endOfDay(now);
  } else if (type === 'week') {
    a = new Date(now);
    const day = a.getDay() || 7;
    a.setDate(a.getDate() - day + 1);
    a = startOfDay(a);
    b = endOfDay(now);
  } else if (type === 'month') {
    a = new Date(now.getFullYear(), now.getMonth(), 1);
    a = startOfDay(a);
    b = endOfDay(now);
  } else {
    a = from ? startOfDay(parseDateInput(from)) : startOfDay(now);
    b = to ? endOfDay(parseDateInput(to)) : endOfDay(now);
  }
  return { a, b };
}
