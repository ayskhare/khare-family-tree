// app.js — init, router, shared state
import { fetchAll } from "./api.js";
import { showToast } from "./utils.js";
import { initTree } from "./tree.js";
import { initSearch } from "./search.js";
import { initDates } from "./dates.js";
import { initMatch } from "./match.js";

// ── Shared State ──────────────────────────────────────
export const state = {
  persons: [],
  rels:    [],
  comments:[],
  pMap:    {},       // id → person
};

// ── Helpers (graph) ───────────────────────────────────
export function getSpouse(id) {
  const r = state.rels.find(r => r.type === "spouse" && (r.person1_id === id || r.person2_id === id));
  if (!r) return null;
  return state.pMap[r.person1_id === id ? r.person2_id : r.person1_id] || null;
}
export function getParent(id) {
  const r = state.rels.find(r => r.type === "parent_child" && r.person2_id === id);
  return r ? (state.pMap[r.person1_id] || null) : null;
}
export function getChildren(id) {
  return state.rels
    .filter(r => r.type === "parent_child" && r.person1_id === id)
    .map(r => state.pMap[r.person2_id])
    .filter(Boolean);
}


// ── Router / Tab switching ─────────────────────────────
const TABS = ["tree", "search", "dates", "match"];
let _activeTab = "tree";

export function switchTab(tabId) {
  if (!TABS.includes(tabId)) return;
  _activeTab = tabId;
  // Update nav
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  // Update panels
  document.querySelectorAll(".panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `panel-${tabId}`);
  });
  // Lazily render dates/match on first show
  if (tabId === "dates")  window._datesReady  || (initDates(),  window._datesReady  = true);
  if (tabId === "match")  window._matchReady  || (initMatch(),  window._matchReady  = true);
  if (tabId === "search") document.getElementById("search-input")?.focus();
}

// ── Init ──────────────────────────────────────────────
async function init() {
  try {
    const data = await fetchAll();
    state.persons  = data.persons;
    state.rels     = data.relationships;
    state.comments = data.comments;
    data.persons.forEach(p => (state.pMap[p.id] = p));

    // Boot modules
    initTree();
    initSearch();

    // Wire bottom nav
    document.querySelectorAll(".nav-tab").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    // Header search button → jump to search tab
    document.getElementById("header-search-btn")?.addEventListener("click", () => switchTab("search"));

    // Dismiss loading screen
    const ls = document.getElementById("loading-screen");
    ls.classList.add("fade-out");
    setTimeout(() => ls.remove(), 550);

  } catch (e) {
    const ls = document.getElementById("loading-screen");
    ls.innerHTML = `<p style="color:#F4843A;font-family:sans-serif;padding:24px;text-align:center">❌ ${e.message}</p>`;
    console.error(e);
  }
}

init();
