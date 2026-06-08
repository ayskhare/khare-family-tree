// dates.js — 🎂 birthday & anniversary calendar
import { state, getSpouse } from "./app.js";
import { cleanName, shortName, monthDay, daysUntil, MONTH_NAMES } from "./utils.js";
import { openSheet } from "./tree.js";

let _view = "upcoming"; // "upcoming" | "all" | "anniversaries"

export function initDates() {
  document.querySelectorAll(".dates-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _view = btn.dataset.view;
      document.querySelectorAll(".dates-tab-btn").forEach(b => b.classList.toggle("active", b === btn));
      _render();
    });
  });
  _render();
}

function _render() {
  const container = document.getElementById("dates-content");
  if (_view === "upcoming")     _renderUpcoming(container);
  else if (_view === "all")     _renderAllByMonth(container);
  else if (_view === "anniversaries") _renderAnniversaries(container);
}

// ── Collect birthdays ─────────────────────────────────
function _getBirthdays() {
  return state.persons
    .filter(p => p.birth_date && p.is_alive !== false)
    .map(p => {
      const md = monthDay(p.birth_date);
      return { ...md, person: p, type: "birthday" };
    });
}

// ── Collect anniversaries ─────────────────────────────
function _getAnniversaries() {
  const seen = new Set();
  return state.rels
    .filter(r => r.type === "spouse" && r.marriage_date && !r.is_divorced)
    .filter(r => {
      const key = [r.person1_id, r.person2_id].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => {
      const md = monthDay(r.marriage_date);
      const p1 = state.pMap[r.person1_id];
      const p2 = state.pMap[r.person2_id];
      if (!md || !p1) return null;
      return { ...md, person: p1, person2: p2, type: "anniversary", marriageDate: r.marriage_date };
    })
    .filter(Boolean);
}

// ── Upcoming (next 60 days, sorted) ──────────────────
function _renderUpcoming(container) {
  const all = [..._getBirthdays(), ..._getAnniversaries()];
  const withDays = all.map(e => ({ ...e, days: daysUntil(e.month, e.day) }));
  const upcoming = withDays
    .filter(e => e.days <= 60)
    .sort((a, b) => a.days - b.days);

  if (!upcoming.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">🎉</div><div class="es-title">All clear for 60 days!</div><div class="es-sub">No birthdays or anniversaries coming up soon.</div></div>`;
    return;
  }

  container.innerHTML = "";
  upcoming.forEach(e => container.appendChild(_makeEntry(e, true)));
}

// ── All by month ──────────────────────────────────────
function _renderAllByMonth(container) {
  const all = _getBirthdays();
  const byMonth = {};
  all.forEach(e => (byMonth[e.month] = byMonth[e.month] || []).push(e));

  container.innerHTML = "";
  MONTH_NAMES.forEach((name, idx) => {
    if (!byMonth[idx]) return;
    const entries = byMonth[idx].sort((a, b) => a.day - b.day);
    const group = document.createElement("div");
    group.className = "month-group";
    group.innerHTML = `<div class="month-label">${name} <span class="month-count">${entries.length}</span></div>`;
    entries.forEach(e => group.appendChild(_makeEntry(e, false)));
    container.appendChild(group);
  });

  if (!container.children.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">🎂</div><div class="es-title">No birthdays recorded</div></div>`;
  }
}

// ── Anniversaries ─────────────────────────────────────
function _renderAnniversaries(container) {
  const all = _getAnniversaries();
  if (!all.length) {
    container.innerHTML = `<div class="empty-state"><div class="es-icon">💍</div><div class="es-title">No anniversaries found</div><div class="es-sub">Add marriage dates in the database to see them here.</div></div>`;
    return;
  }

  const byMonth = {};
  all.forEach(e => (byMonth[e.month] = byMonth[e.month] || []).push(e));

  container.innerHTML = "";
  MONTH_NAMES.forEach((name, idx) => {
    if (!byMonth[idx]) return;
    const entries = byMonth[idx].sort((a, b) => a.day - b.day);
    const group = document.createElement("div");
    group.className = "month-group";
    group.innerHTML = `<div class="month-label">${name} <span class="month-count">${entries.length}</span></div>`;
    entries.forEach(e => group.appendChild(_makeEntry(e, false)));
    container.appendChild(group);
  });
}

// ── Entry element factory ─────────────────────────────
function _makeEntry(e, showCountdown) {
  const el = document.createElement("div");
  el.className = "date-entry";

  const isBday = e.type === "birthday";
  const icon   = isBday ? "🎂" : "💍";
  const dayClass = isBday ? "birthday" : "anniversary";
  const abbr   = MONTH_NAMES[e.month]?.slice(0, 3).toUpperCase() ?? "";

  let badge = "";
  if (showCountdown) {
    if (e.days === 0)     badge = `<span class="today-badge">🎉 Today!</span>`;
    else if (e.days <= 7) badge = `<span class="upcoming-badge">In ${e.days}d</span>`;
    else                  badge = `<span class="upcoming-badge">${e.days}d</span>`;
  }

  let name = shortName(e.person.name);
  let detail = "";
  if (isBday) {
    detail = `Birthday · ${e.person.current_location || ""}`;
  } else {
    const p2name = e.person2 ? shortName(e.person2.name) : "";
    name = `${name}${p2name ? " & " + p2name : ""}`;
    detail = `Anniversary${e.marriageDate ? " · " + e.marriageDate.slice(0, 4) : ""}`;
  }

  el.innerHTML = `
    <div class="date-day ${dayClass}">
      <span class="day-num">${e.day}</span>
      <span class="day-abbr">${abbr}</span>
    </div>
    <div class="date-info">
      <div class="date-name">${name}</div>
      <div class="date-detail">${detail.trim().replace(/·\s*$/, "")}</div>
    </div>
    <span class="date-type-icon">${icon}</span>
    ${badge}
  `;

  el.addEventListener("click", () => {
    if (isBday) openSheet(e.person.id);
  });
  return el;
}
