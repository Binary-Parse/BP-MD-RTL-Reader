const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEKS = 12;

function toUtc(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function toIso(stamp) {
  const d = new Date(stamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function readingLevel(minutes, goal) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const target = Number(goal);
  if (!Number.isFinite(target) || target <= 0) return 1;
  if (value >= target * 2) return 4;
  if (value >= target) return 3;
  if (value >= target / 2) return 2;
  return 1;
}

export function streakGrid(days, todayISO, { weeks = DEFAULT_WEEKS, goal = 0 } = {}) {
  if (!ISO_DATE.test(String(todayISO || ''))) return [];
  const stored = new Map(Object.entries(days && typeof days === 'object' ? days : {}));
  const today = toUtc(todayISO);
  const mondayFirstWeekday = (new Date(today).getUTCDay() + 6) % 7;
  const weekStart = today - mondayFirstWeekday * DAY_MS;
  const first = weekStart - (weeks - 1) * 7 * DAY_MS;
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const stamp = first + i * DAY_MS;
    const date = toIso(stamp);
    const raw = Number(stored.get(date));
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : 0;
    cells.push({ date, minutes, level: readingLevel(minutes, goal), future: stamp > today });
  }
  return cells;
}
