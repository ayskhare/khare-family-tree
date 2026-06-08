// utils.js — shared helpers

/** Strip honorifics and parenthetical relationship notes from a name. */
export function cleanName(name) {
  return name
    .replace(/\s*\([^)]*\s+(son|daughter|husband|wife)\)/gi, "")
    .replace(/^Shrimati\s+/i, "")
    .replace(/^Shri\s+/i, "")
    .trim();
}

/** Return first + last word (or full cleaned name if ≤2 words). */
export function shortName(name) {
  const c = cleanName(name);
  const w = c.split(" ");
  return w.length > 2 ? `${w[0]} ${w[w.length - 1]}` : c;
}

/** Format a date string (YYYY-MM-DD) as "12 Jan" or "12 Jan 1945". */
export function fmtDate(dateStr, includeYear = false) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const opts = { day: "numeric", month: "short" };
    if (includeYear) opts.year = "numeric";
    return d.toLocaleDateString("en-IN", opts);
  } catch {
    return dateStr;
  }
}

/** Get month index (0-11) and day from a YYYY-MM-DD string. */
export function monthDay(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  return { month: parseInt(parts[1], 10) - 1, day: parseInt(parts[2], 10) };
}

const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];
export { MONTH_NAMES };

/** Show a brief toast message. */
export function showToast(msg, duration = 2800) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove("show"), duration);
}

/** Days until next occurrence of a month/day (0 = today). */
export function daysUntil(month, day) {
  const now  = new Date();
  const next = new Date(now.getFullYear(), month, day);
  if (next < now) next.setFullYear(now.getFullYear() + 1);
  const diff = Math.round((next - now) / 86400000);
  return diff;
}
