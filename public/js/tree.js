// tree.js — 🌳 Full pannable/zoomable family tree + in-tree search + profile sheet
import { state, getSpouse, getParent, getChildren } from "./app.js";
import { cleanName, shortName, fmtDate, showToast } from "./utils.js";
import { postComment, postChangeRequest } from "./api.js";

// ─────────────────────────────────────────────────────
// Layout constants (px, at scale = 1)
// ─────────────────────────────────────────────────────
const NODE_W       = 80;
const NODE_H       = 42;
const NODE_GUTTER  = 20;   // min horizontal gap reserved around each family unit
const SPOUSE_GAP   = 8;    // gap between a blood person's box and their spouse's box
const ROW_H        = 128;  // vertical distance between generation rows
const TOP_PAD       = 30;
const BOTTOM_PAD    = 40;
const MAX_SCALE      = 2.2;
const FOCUS_ROWS     = 4.3; // rows visible at initial "focused" zoom (≈2 up + self + 1 down)

const TAP_MOVE_THRESHOLD_MOUSE = 6;   // px — mouse/trackpad is precise
const TAP_MOVE_THRESHOLD_TOUCH = 12;  // px — fingertips wobble more; be more forgiving
const TAP_TIME_THRESHOLD = 600;       // ms — pointer held longer than this = not a tap

// ─────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────
let _sheetPid = null;   // person shown in the profile sheet
let _homeId   = null;   // default anchor person (Ayush Khare) — used only to set the initial view
let _layout   = null;   // { nodeIndex: {id:{cx,top}}, totalWidth, totalHeight }

let _viewportEl = null;
let _stageEl     = null;
let scale = 1, tx = 0, ty = 0;
let _minScale = 0.05;

let _searchQuery  = "";
let _searchFilter = "all";

// ─────────────────────────────────────────────────────
// Public: init — called by app.js once data is ready
// ─────────────────────────────────────────────────────
export function initTree() {
  _homeId = _findHomePerson();
  const built = _buildForest();
  _layout = _computeLayout(built);
  _renderShell();
  _wirePanZoom();
  _wireSearchOverlay();
  _wireSheet();
  _resetView(false);
  window.addEventListener("resize", _onResize);
}

// Find the default landing person: "Ayush Khare". Since more than one
// person can share a name in the tree, prefer the one whose parent is
// "Arun Khare" (matches known family history). Falls back gracefully.
// Used only to decide where the tree centers on load / on Home tap —
// the person themself isn't marked or treated specially in the tree.
function _findHomePerson() {
  const candidates = state.persons.filter(
    p => cleanName(p.name).toLowerCase() === "ayush khare"
  );
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length > 1) {
    const preferred = candidates.find(p => {
      const parent = getParent(p.id);
      return parent && cleanName(parent.name).toLowerCase() === "arun khare";
    });
    return (preferred || candidates[0]).id;
  }
  const fallback = [...state.persons]
    .filter(p => p.blood_member)
    .sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0))[0];
  return (fallback || state.persons[0])?.id ?? null;
}

// focusPerson — pan/zoom the canvas to a given person (used by search + external callers)
export function focusPerson(id) {
  const n = _layout?.nodeIndex?.[id];
  if (!n || !_viewportEl) return;
  const rect = _viewportEl.getBoundingClientRect();
  scale = clamp(Math.max(scale, 0.85), _minScale, MAX_SCALE);
  tx = rect.width  / 2 - n.cx * scale;
  ty = rect.height / 2 - (n.top + NODE_H / 2) * scale;
  _applyTransform(true);
  _flashNode(id);
}
// Backward-compatible alias
export function jumpTo(id) { focusPerson(id); }

export function toggleTreeSearch(forceOpen) {
  const overlay = document.getElementById("tree-search-overlay");
  if (!overlay) return;
  const shouldOpen = forceOpen ?? !overlay.classList.contains("open");
  overlay.classList.toggle("open", shouldOpen);
  if (shouldOpen) {
    setTimeout(() => document.getElementById("tsearch-input")?.focus(), 180);
  }
}

// ─────────────────────────────────────────────────────
// Forest construction: blood-line tree, spouses attached to their partner
// ─────────────────────────────────────────────────────
function _buildForest() {
  const childrenMap = {};      // bloodParentId -> [childId,...]
  const parentOf    = {};      // childId -> parentId
  const spouseOf     = {};      // bloodId -> spouseId
  const attachedSpouse = new Set(); // ids that are "married in" and rendered beside their partner

  state.rels.forEach(r => {
    if (r.type === "parent_child") {
      (childrenMap[r.person1_id] = childrenMap[r.person1_id] || []).push(r.person2_id);
      parentOf[r.person2_id] = r.person1_id;
    } else if (r.type === "spouse") {
      spouseOf[r.person1_id] = r.person2_id;
      attachedSpouse.add(r.person2_id);
    }
  });

  function buildUnit(bloodId) {
    const person   = state.pMap[bloodId];
    if (!person) return null;
    const spouseId = spouseOf[bloodId];
    const spouse    = spouseId ? state.pMap[spouseId] : null;
    const childIds  = childrenMap[bloodId] || [];
    const children  = childIds.map(buildUnit).filter(Boolean);
    return { id: bloodId, person, spouse, children };
  }

  const roots = state.persons
    .filter(p => !parentOf[p.id] && !attachedSpouse.has(p.id))
    .map(p => buildUnit(p.id))
    .filter(Boolean);

  return roots;
}

// ─────────────────────────────────────────────────────
// Tidy-tree layout: compute cx (center-x, px) for every unit, then
// flatten into per-person node positions + connector line geometry.
// ─────────────────────────────────────────────────────
function _unitFootprint(unit) {
  const w = unit.spouse ? (NODE_W * 2 + SPOUSE_GAP) : NODE_W;
  return w + NODE_GUTTER;
}

function _computeSubtreeWidths(unit) {
  if (!unit.children.length) {
    unit.subtreeWidth = _unitFootprint(unit);
    return unit.subtreeWidth;
  }
  let total = 0;
  unit.children.forEach(c => { total += _computeSubtreeWidths(c); });
  unit.subtreeWidth = Math.max(_unitFootprint(unit), total);
  return unit.subtreeWidth;
}

function _assignX(unit, offset) {
  if (!unit.children.length) {
    unit.cx = offset + unit.subtreeWidth / 2;
    return;
  }
  const childrenTotal = unit.children.reduce((s, c) => s + c.subtreeWidth, 0);
  let childOffset = offset + Math.max(0, (unit.subtreeWidth - childrenTotal) / 2);
  unit.children.forEach(c => {
    _assignX(c, childOffset);
    childOffset += c.subtreeWidth;
  });
  const firstCx = unit.children[0].cx;
  const lastCx  = unit.children[unit.children.length - 1].cx;
  unit.cx = (firstCx + lastCx) / 2;
}

function _computeLayout(roots) {
  let offset = 0;
  roots.forEach(r => { _computeSubtreeWidths(r); });
  roots.forEach(r => { _assignX(r, offset); offset += r.subtreeWidth; });

  const nodeIndex = {};   // personId -> {cx, top}
  const nodesOut  = [];
  const linesOut  = [];
  let maxGen = 0;

  function collect(unit) {
    const gen = unit.person.generation ?? 0;
    maxGen = Math.max(maxGen, gen);
    const top = TOP_PAD + gen * ROW_H;

    const bloodCx = unit.spouse ? unit.cx - (NODE_W / 2 + SPOUSE_GAP / 2) : unit.cx;
    nodeIndex[unit.person.id] = { cx: bloodCx, top };
    nodesOut.push({ id: unit.person.id, cx: bloodCx, top });

    if (unit.spouse) {
      const spouseCx = unit.cx + (NODE_W / 2 + SPOUSE_GAP / 2);
      nodeIndex[unit.spouse.id] = { cx: spouseCx, top };
      nodesOut.push({ id: unit.spouse.id, cx: spouseCx, top });
      const midY = top + NODE_H / 2;
      linesOut.push(`<line x1="${bloodCx + NODE_W/2}" y1="${midY}" x2="${spouseCx - NODE_W/2}" y2="${midY}" class="tl-marriage"/>`);
    }

    if (unit.children.length) {
      const bottom = top + NODE_H;
      const busY   = bottom + (ROW_H - NODE_H) / 2;
      linesOut.push(`<line x1="${unit.cx}" y1="${bottom}" x2="${unit.cx}" y2="${busY}" class="tl-drop"/>`);
      const childXs = unit.children.map(c => c.cx);
      const minX = Math.min(...childXs), maxX = Math.max(...childXs);
      if (unit.children.length > 1) {
        linesOut.push(`<line x1="${minX}" y1="${busY}" x2="${maxX}" y2="${busY}" class="tl-bus"/>`);
      }
      unit.children.forEach(c => {
        const childTop = TOP_PAD + (c.person.generation ?? 0) * ROW_H;
        linesOut.push(`<line x1="${c.cx}" y1="${busY}" x2="${c.cx}" y2="${childTop}" class="tl-drop"/>`);
        collect(c);
      });
    }
  }
  roots.forEach(collect);

  const totalWidth  = Math.max(offset, 200);
  const totalHeight = TOP_PAD + (maxGen + 1) * ROW_H + BOTTOM_PAD;

  return { nodeIndex, nodesOut, linesOut, totalWidth, totalHeight };
}

// ─────────────────────────────────────────────────────
// Render shell — built once; canvas persists across tab switches
// ─────────────────────────────────────────────────────
function _renderShell() {
  const canvas = document.getElementById("tree-canvas");
  if (!canvas) return;

  const nodesHtml = _layout.nodesOut.map(n => {
    const p = state.pMap[n.id];
    if (!p) return "";
    const cls = [
      "tn-node",
      p.blood_member ? "tn-blood" : "tn-married",
      p.is_alive === false ? "tn-deceased" : "",
    ].filter(Boolean).join(" ");
    return `<div class="${cls}" data-pid="${n.id}" title="${cleanName(p.name)}"
              style="left:${n.cx - NODE_W/2}px; top:${n.top}px; width:${NODE_W}px; height:${NODE_H}px;">
              <span class="tn-name">${shortName(p.name)}</span>
            </div>`;
  }).join("");

  const svgLines = `<svg class="tree-lines" width="${_layout.totalWidth}" height="${_layout.totalHeight}">
      ${_layout.linesOut.join("")}
    </svg>`;

  canvas.innerHTML = `
    <div class="tree-toolbar">
      <button class="tree-home-btn" id="tree-home-btn">🏠 Home</button>
      <div class="tree-zoom-group">
        <button class="tree-zoom-btn" id="tree-zoom-out" aria-label="Zoom out">−</button>
        <button class="tree-zoom-btn" id="tree-zoom-in" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="tree-search-overlay" id="tree-search-overlay">
      <div class="search-bar-wrap" style="padding:10px 12px 8px;border-bottom:none;">
        <div class="search-bar" id="tsearch-bar-el">
          <span class="search-icon">🔍</span>
          <input id="tsearch-input" type="search" placeholder="Search by name or location…" autocomplete="off" autocorrect="off" spellcheck="false">
          <button class="clear-btn" id="tsearch-clear-btn" aria-label="Clear">✕</button>
        </div>
        <div class="search-filters">
          <button class="filter-chip active" data-filter="all">All</button>
          <button class="filter-chip" data-filter="blood">🩸 Khare</button>
          <button class="filter-chip" data-filter="married">💍 Married in</button>
          <button class="filter-chip" data-filter="deceased">🕊️ Deceased</button>
        </div>
      </div>
      <div id="tsearch-results" class="tsearch-results"></div>
    </div>
    <div class="tree-viewport" id="tree-viewport">
      <div class="tree-stage" id="tree-stage" style="width:${_layout.totalWidth}px;height:${_layout.totalHeight}px;">
        ${svgLines}
        <div class="tree-nodes">${nodesHtml}</div>
      </div>
    </div>
  `;

  _viewportEl = document.getElementById("tree-viewport");
  _stageEl    = document.getElementById("tree-stage");

  document.getElementById("tree-home-btn").addEventListener("click", () => {
    toggleTreeSearch(false);
    _resetView(true);
  });
  document.getElementById("tree-zoom-in").addEventListener("click", () => _zoomButton(1.3));
  document.getElementById("tree-zoom-out").addEventListener("click", () => _zoomButton(1/1.3));
}

// ─────────────────────────────────────────────────────
// Pan & zoom controller (+ manual tap detection for opening profiles)
// ─────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function _applyTransform(animate) {
  _stageEl.style.transition = animate ? "transform 0.4s cubic-bezier(0.22,1,0.36,1)" : "none";
  _stageEl.style.transform  = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function _zoomAt(newScale, clientX, clientY) {
  const rect = _viewportEl.getBoundingClientRect();
  const originX = clientX - rect.left;
  const originY = clientY - rect.top;
  const contentX = (originX - tx) / scale;
  const contentY = (originY - ty) / scale;
  scale = clamp(newScale, _minScale, MAX_SCALE);
  tx = originX - contentX * scale;
  ty = originY - contentY * scale;
  _applyTransform(false);
}

function _zoomButton(factor) {
  const rect = _viewportEl.getBoundingClientRect();
  _zoomAt(scale * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function _resetView(animate) {
  const home = _layout.nodeIndex[_homeId];
  const rect = _viewportEl.getBoundingClientRect();
  const vw = rect.width  || 360;
  const vh = rect.height || 560;

  _minScale = Math.min(vw / _layout.totalWidth, vh / _layout.totalHeight) * 0.94;
  const initialScale = clamp(vh / (ROW_H * FOCUS_ROWS), _minScale, 1.3);
  scale = initialScale;

  if (home) {
    const cx = home.cx, cy = home.top + NODE_H / 2;
    tx = vw / 2 - cx * scale;
    ty = vh * 0.62 - cy * scale; // bias down so ~2 gens above are visible
  } else {
    tx = 0; ty = 0;
  }
  _applyTransform(animate);
}

function _flashNode(id) {
  const el = document.querySelector(`.tn-node[data-pid="${id}"]`);
  if (!el) return;
  el.classList.remove("tn-flash");
  void el.offsetWidth; // restart animation
  el.classList.add("tn-flash");
  setTimeout(() => el.classList.remove("tn-flash"), 1000);
}

function _onResize() {
  if (!_viewportEl || !_layout) return;
  const rect = _viewportEl.getBoundingClientRect();
  _minScale = Math.min(rect.width / _layout.totalWidth, rect.height / _layout.totalHeight) * 0.94;
  scale = clamp(scale, _minScale, MAX_SCALE);
  _applyTransform(false);
}

function _wirePanZoom() {
  const vp = _viewportEl;
  const pointers = new Map();
  let dragStart = null;
  let lastDist  = null;

  // Manual tap detection — replaces native "click" because pointer capture
  // (needed for reliable drag/pinch) makes native click unreliable across
  // browsers/input devices. Move tolerance adapts to input type: touch
  // gets more slack since fingertips are naturally less precise than a
  // mouse/trackpad cursor.
  let tapCandidate    = null;  // { pid, time, moveThreshold }
  let sessionMoved    = false;
  let sessionWasMulti = false;

  function dist() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  vp.addEventListener("pointerdown", e => {
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    _stageEl.style.transition = "none";

    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, tx, ty };
      vp.classList.add("dragging");
      sessionMoved = false;
      sessionWasMulti = false;
      const nodeEl = e.target.closest(".tn-node");
      const moveThreshold = e.pointerType === "touch" ? TAP_MOVE_THRESHOLD_TOUCH : TAP_MOVE_THRESHOLD_MOUSE;
      tapCandidate = nodeEl ? { pid: nodeEl.dataset.pid, time: Date.now(), moveThreshold } : null;
    } else if (pointers.size === 2) {
      lastDist = dist();
      dragStart = null;
      sessionWasMulti = true;
      tapCandidate = null;
    }
  });

  vp.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      const threshold = tapCandidate?.moveThreshold ?? TAP_MOVE_THRESHOLD_MOUSE;
      if (Math.hypot(dx, dy) > threshold) sessionMoved = true;
      tx = dragStart.tx + dx;
      ty = dragStart.ty + dy;
      _applyTransform(false);
    } else if (pointers.size === 2) {
      sessionWasMulti = true;
      const d = dist();
      const [p1, p2] = [...pointers.values()];
      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
      if (lastDist) _zoomAt(scale * (d / lastDist), midX, midY);
      lastDist = d;
    }
  });

  function endPointer(e) {
    const wasSingle = pointers.size === 1 && !sessionWasMulti;
    pointers.delete(e.pointerId);
    vp.classList.remove("dragging");
    if (pointers.size < 2) lastDist = null;

    if (pointers.size === 0) {
      if (wasSingle && !sessionMoved && tapCandidate && (Date.now() - tapCandidate.time) < TAP_TIME_THRESHOLD) {
        openSheet(tapCandidate.pid);
      }
      dragStart = null;
      tapCandidate = null;
    } else if (pointers.size === 1) {
      const [p] = [...pointers.values()];
      dragStart = { x: p.x, y: p.y, tx, ty };
      tapCandidate = null; // a pinch was in progress — don't treat the remaining finger as a tap
    }
  }
  vp.addEventListener("pointerup", endPointer);
  vp.addEventListener("pointercancel", endPointer);
  vp.addEventListener("pointerleave", endPointer);

  vp.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    _zoomAt(scale * factor, e.clientX, e.clientY);
  }, { passive: false });
}

// ─────────────────────────────────────────────────────
// In-tree search overlay
// ─────────────────────────────────────────────────────
function _wireSearchOverlay() {
  const input   = document.getElementById("tsearch-input");
  const clearBtn = document.getElementById("tsearch-clear-btn");
  const barEl   = document.getElementById("tsearch-bar-el");

  input.addEventListener("input", () => {
    _searchQuery = input.value;
    barEl.classList.toggle("has-value", !!_searchQuery);
    _renderSearchResults();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    _searchQuery = "";
    barEl.classList.remove("has-value");
    _renderSearchResults();
    input.focus();
  });
  document.querySelectorAll("#tree-search-overlay .filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      _searchFilter = chip.dataset.filter;
      document.querySelectorAll("#tree-search-overlay .filter-chip").forEach(c => c.classList.toggle("active", c === chip));
      _renderSearchResults();
    });
  });
}

function _renderSearchResults() {
  const list = document.getElementById("tsearch-results");
  if (!_searchQuery.trim() && _searchFilter === "all") {
    list.innerHTML = `<div class="search-hint">
      <div class="hint-icon">🔍</div>
      <p>Type a name or location to find someone —<br>the tree will pan and zoom to them</p>
    </div>`;
    return;
  }

  const q = _searchQuery.toLowerCase().trim();
  let results = state.persons.filter(p => {
    const matchText = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.current_location || "").toLowerCase().includes(q) ||
      String(p.generation || "").includes(q);
    const matchFilter =
      _searchFilter === "all"      ? true :
      _searchFilter === "blood"    ? p.blood_member :
      _searchFilter === "married"  ? !p.blood_member :
      _searchFilter === "deceased" ? p.is_alive === false :
      true;
    return matchText && matchFilter;
  }).sort((a, b) => {
    if (a.blood_member !== b.blood_member) return a.blood_member ? -1 : 1;
    if ((a.generation ?? 99) !== (b.generation ?? 99)) return (a.generation ?? 99) - (b.generation ?? 99);
    return a.name.localeCompare(b.name);
  }).slice(0, 60);

  if (!results.length) {
    list.innerHTML = `<div class="search-hint">
      <div class="hint-icon">🤔</div>
      <p>No results found for "<strong>${_searchQuery}</strong>"</p>
    </div>`;
    return;
  }

  list.innerHTML = "";
  results.forEach(p => {
    const el = document.createElement("div");
    el.className = "person-card";
    const avatarClass = p.blood_member ? "avatar-blood" : "avatar-married";
    const icon = p.blood_member ? (p.gender === "F" ? "👩" : "👨") : (p.gender === "F" ? "👩" : "🧑");
    el.innerHTML = `
      <div class="person-card-avatar ${avatarClass}">${icon}</div>
      <div class="person-card-info">
        <div class="person-card-name">${cleanName(p.name)}</div>
        <div class="person-card-meta">
          ${p.current_location ? `<span>📍 ${p.current_location}</span>` : ""}
          ${p.is_alive === false ? `<span>🕊️ Deceased</span>` : ""}
        </div>
      </div>
      <div class="person-card-gen">G${p.generation ?? "?"}</div>
    `;
    el.addEventListener("click", () => {
      toggleTreeSearch(false);
      focusPerson(p.id);
    });
    list.appendChild(el);
  });
}

// ─────────────────────────────────────────────────────
// Profile sheet
// ─────────────────────────────────────────────────────
export function openSheet(id) {
  _sheetPid = id;
  const p = state.pMap[id]; if (!p) return;

  document.getElementById("sheet-name").textContent = cleanName(p.name);
  document.getElementById("sheet-meta").innerHTML =
    `<span>Generation ${p.generation ?? "?"}</span>` +
    `<span>${p.blood_member ? "Khare bloodline" : "Married in"}</span>`;

  const badges = document.getElementById("sheet-badges");
  badges.innerHTML =
    (p.blood_member ? `<span class="sheet-badge badge-blood">🩸 Khare</span>` : `<span class="sheet-badge badge-married">💍 Married in</span>`) +
    (p.gender === "F" ? `<span class="sheet-badge badge-female">♀ Female</span>` : p.gender === "M" ? `<span class="sheet-badge badge-male">♂ Male</span>` : "") +
    (p.is_alive === false ? `<span class="sheet-badge badge-deceased">🕊️ Deceased</span>` : "") +
    (p.needs_review ? `<span class="sheet-badge badge-review">⚠️ Needs review</span>` : "");

  const spouse   = getSpouse(id);
  const parent   = getParent(id);
  const children = getChildren(id);
  const pc       = state.comments.filter(c => c.person_id === id);

  const rows = [
    ["Name",       cleanName(p.name)],
    ["Gender",     p.gender === "M" ? "♂ Male" : p.gender === "F" ? "♀ Female" : "—"],
    ["Generation", `Gen ${p.generation ?? "?"}`],
    ["Location",   p.current_location || "—"],
    ["Born",       fmtDate(p.birth_date, true)],
    ["Status",     p.is_alive !== false ? "Living" : "Deceased"],
    ["Lineage",    p.blood_member ? "Khare bloodline" : "Married in"],
  ];
  if (spouse)          rows.push(["Spouse",   cleanName(spouse.name)]);
  if (parent)          rows.push(["Parent",   cleanName(parent.name)]);
  if (children.length) rows.push(["Children", children.map(c => shortName(c.name)).join(", ")]);
  if (p.notes)         rows.push(["Notes",    p.notes]);

  let infoHtml = rows.map(([l, v]) =>
    `<div class="info-row"><span class="info-label">${l}</span><span class="info-value">${v}</span></div>`
  ).join("");

  if (pc.length) {
    infoHtml += `<div style="margin-top:16px">
      <div style="font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px">💬 Comments</div>
      ${pc.map(c => `<div class="comment-card">
        <div class="comment-author">${c.commenter_name}</div>
        <div class="comment-text">${c.content}</div>
        <div class="comment-date">${c.created_at?.slice(0, 10)}</div>
      </div>`).join("")}
    </div>`;
  }
  document.getElementById("stab-info").innerHTML = infoHtml;

  // Relatives tab — mini org-chart widget: grandparents → parents → self+spouse → children
  document.getElementById("stab-relatives").innerHTML = _buildFocusView(id);
  document.querySelectorAll("#stab-relatives .fv-node[data-pid]").forEach(node => {
    node.addEventListener("click", () => openSheet(node.dataset.pid));
  });

  _prefillOld();
  _setSheetTab("info");
  document.getElementById("sheet-backdrop").classList.add("open");
  document.getElementById("profile-sheet").classList.add("open");
}

// Mini focus widget used inside the sheet's "Lineage" tab only
function _buildFocusView(id) {
  const person  = state.pMap[id]; if (!person) return "";
  const parent  = getParent(id);
  const grandpa = parent ? getParent(parent.id) : null;

  let gpRow = "";
  if (grandpa) {
    const gpSpouse = getSpouse(grandpa.id);
    gpRow = `
      <div class="fv-row fv-row-gp">
        <div class="fv-label">Grandparents</div>
        <div class="fv-nodes">
          ${_fvNode(grandpa, "gp")}
          ${gpSpouse ? _fvNode(gpSpouse, "gp-sp") : ""}
        </div>
      </div>
      <div class="fv-connector"><div class="fv-vline"></div></div>`;
  }

  let pRow = "";
  if (parent) {
    const pSpouse = getSpouse(parent.id);
    pRow = `
      <div class="fv-row fv-row-parent">
        <div class="fv-label">Parents</div>
        <div class="fv-nodes">
          ${_fvNode(parent, "parent")}
          ${pSpouse ? _fvNode(pSpouse, "parent-sp") : ""}
        </div>
      </div>
      <div class="fv-connector"><div class="fv-vline"></div></div>`;
  }

  const spouse  = getSpouse(id);
  const selfRow = `
    <div class="fv-row fv-row-self">
      <div class="fv-label">Selected</div>
      <div class="fv-nodes">
        ${_fvNode(person, "self")}
        ${spouse ? _fvNode(spouse, "self-sp") : ""}
      </div>
    </div>`;

  const children = getChildren(id);
  let cRow = "";
  if (children.length) {
    cRow = `
      <div class="fv-connector"><div class="fv-vline"></div></div>
      <div class="fv-row fv-row-children">
        <div class="fv-label">Children</div>
        <div class="fv-nodes fv-nodes-wrap">
          ${children.map(c => _fvNode(c, "child")).join("")}
        </div>
      </div>`;
  }

  if (!grandpa && !parent && !children.length && !spouse) {
    return `<p style="color:var(--muted);font-size:0.82rem;padding:16px 0">No family connections found.</p>`;
  }
  return `<div class="focus-view">${gpRow}${pRow}${selfRow}${cRow}</div>`;
}

function _fvNode(p, role) {
  const isSelf  = role === "self";
  const isChild = role === "child";
  const name = shortName(p.name);
  return `<div class="fv-node fv-role-${role}${isSelf ? " fv-self" : ""}" data-pid="${p.id}" title="${cleanName(p.name)}">
    <div class="fv-node-name">${name}</div>
    ${!isChild && p.current_location ? `<div class="fv-node-loc">📍 ${p.current_location}</div>` : ""}
  </div>`;
}

function _closeSheet() {
  document.getElementById("profile-sheet").classList.remove("open");
  document.getElementById("sheet-backdrop").classList.remove("open");
}

function _setSheetTab(name) {
  document.querySelectorAll(".sheet-tab").forEach(t => t.classList.toggle("active", t.dataset.stab === name));
  document.querySelectorAll(".sheet-tab-panel").forEach(p => p.classList.toggle("active", p.id === `stab-${name}`));
}

function _prefillOld() {
  const p = state.pMap[_sheetPid]; if (!p) return;
  const f = document.getElementById("s-field")?.value;
  if (f) document.getElementById("s-old").value = p[f] || "";
}

function _wireSheet() {
  document.querySelectorAll(".sheet-tab").forEach(btn => {
    btn.addEventListener("click", () => _setSheetTab(btn.dataset.stab));
  });
  document.getElementById("s-field")?.addEventListener("change", _prefillOld);
  document.getElementById("sheet-backdrop").addEventListener("click", _closeSheet);
  document.getElementById("sheet-close-btn")?.addEventListener("click", _closeSheet);

  document.getElementById("btn-submit-comment")?.addEventListener("click", async () => {
    const name    = document.getElementById("c-name").value.trim();
    const email   = document.getElementById("c-email").value.trim();
    const content = document.getElementById("c-content").value.trim();
    if (!name || !content) { showToast("Name and comment are required."); return; }
    try {
      await postComment({ person_id: _sheetPid, commenter_name: name, commenter_email: email, content });
      showToast("✅ Comment submitted — pending approval!");
      document.getElementById("c-name").value = "";
      document.getElementById("c-content").value = "";
      _closeSheet();
    } catch (e) { showToast("❌ " + e.message); }
  });

  document.getElementById("btn-submit-suggest")?.addEventListener("click", async () => {
    const name    = document.getElementById("s-name").value.trim();
    const email   = document.getElementById("s-email").value.trim();
    const field   = document.getElementById("s-field").value;
    const old_val = document.getElementById("s-old").value;
    const new_val = document.getElementById("s-new").value.trim();
    if (!name || !new_val) { showToast("Name and correct value are required."); return; }
    try {
      await postChangeRequest({ person_id: _sheetPid, requested_by_name: name, requested_by_email: email, field_name: field, old_value: old_val, new_value: new_val });
      showToast("✅ Suggestion submitted — thank you!");
      document.getElementById("s-new").value = "";
      _closeSheet();
    } catch (e) { showToast("❌ " + e.message); }
  });
}
