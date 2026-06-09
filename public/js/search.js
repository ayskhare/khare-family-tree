// search.js — 🔍 search + person cards
import { state } from "./app.js";
import { cleanName, shortName } from "./utils.js";
import { openSheet } from "./tree.js";

let _filter = "all";
let _query  = "";

export function initSearch() {
  const input   = document.getElementById("search-input");
  const clearBtn = document.getElementById("search-clear-btn");
  const barEl   = document.getElementById("search-bar-el");

  input.addEventListener("input", () => {
    _query = input.value;
    barEl.classList.toggle("has-value", !!_query);
    _render();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    _query = "";
    barEl.classList.remove("has-value");
    _render();
    input.focus();
  });

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      _filter = chip.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.toggle("active", c === chip));
      _render();
    });
  });
}

function _render() {
  const list = document.getElementById("search-results-list");

  if (!_query.trim() && _filter === "all") {
    list.innerHTML = `<div class="search-hint">
      <div class="hint-icon">🔍</div>
      <p>Type a name, location, or generation<br>to find family members</p>
    </div>`;
    return;
  }

  const q = _query.toLowerCase().trim();

  let results = state.persons.filter(p => {
    const matchText = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.current_location || "").toLowerCase().includes(q) ||
      String(p.generation || "").includes(q) ||
      (p.notes || "").toLowerCase().includes(q);

    const matchFilter =
      _filter === "all"      ? true :
      _filter === "blood"    ? p.blood_member :
      _filter === "married"  ? !p.blood_member :
      _filter === "deceased" ? p.is_alive === false :
      true;

    return matchText && matchFilter;
  });

  // Sort: blood first, then by generation, then name
  results.sort((a, b) => {
    if (a.blood_member !== b.blood_member) return a.blood_member ? -1 : 1;
    if ((a.generation ?? 99) !== (b.generation ?? 99)) return (a.generation ?? 99) - (b.generation ?? 99);
    return a.name.localeCompare(b.name);
  });

  if (!results.length) {
    list.innerHTML = `<div class="search-hint">
      <div class="hint-icon">🤔</div>
      <p>No results found for "<strong>${_query}</strong>"</p>
    </div>`;
    return;
  }

  // Group by generation
  const byGen = {};
  results.forEach(p => {
    const g = p.generation ?? "?";
    (byGen[g] = byGen[g] || []).push(p);
  });

  list.innerHTML = "";
  Object.keys(byGen).sort((a, b) => Number(a) - Number(b)).forEach(gen => {
    const label = document.createElement("div");
    label.className = "search-section-label";
    label.textContent = gen === "?" ? "Unknown generation" : `Generation ${gen}`;
    list.appendChild(label);

    byGen[gen].forEach(p => {
      const card = _makePersonCard(p);
      list.appendChild(card);
    });
  });
}

function _makePersonCard(p) {
  const el = document.createElement("div");
  el.className = "person-card";

  const avatarClass = p.blood_member ? "avatar-blood" : "avatar-married";
  const icon = p.blood_member
    ? (p.gender === "F" ? "👩" : "👨")
    : (p.gender === "F" ? "👩" : "🧑");

  el.innerHTML = `
    <div class="person-card-avatar ${avatarClass}">${icon}</div>
    <div class="person-card-info">
      <div class="person-card-name">${cleanName(p.name)}</div>
      <div class="person-card-meta">
        ${p.current_location ? `<span>📍 ${p.current_location}</span>` : ""}
        ${p.is_alive === false ? `<span>🕊️ Deceased</span>` : ""}
        ${p.needs_review ? `<span>⚠️ Review</span>` : ""}
      </div>
    </div>
    <div class="person-card-gen">G${p.generation ?? "?"}</div>
  `;

  el.addEventListener("click", () => {
    openSheet(p.id);
  });
  return el;
}
