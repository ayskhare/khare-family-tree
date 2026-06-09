// tree.js — 🌳 Full tree SVG render + pan/zoom + profile sheet
import { state, getSpouse, getParent, getChildren } from "./app.js";
import { cleanName, shortName, fmtDate, showToast } from "./utils.js";
import { postComment, postChangeRequest } from "./api.js";

// ─────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────
const NW        = 100;  // node width
const NH        = 52;   // node height
const SPOUSE_W  = 88;   // spouse node width (slightly narrower)
const SGAP      = 10;   // gap between primary and spouse
const HGAP      = 22;   // horizontal gap between sibling subtrees
const VGAP      = 80;   // vertical gap between generations
const ROUNDING  = 8;    // card corner radius

// ─────────────────────────────────────────────────────
// Profile sheet state
// ─────────────────────────────────────────────────────
let _sheetPid = null;

// ─────────────────────────────────────────────────────
// Build derived maps once data is ready
// ─────────────────────────────────────────────────────
let _primaryIds   = new Set(); // nodes that are "main" (have parent/child rels)
let _satelliteMap = {};        // primaryId → satelliteSpouseId
let _primaryOf    = {};        // satelliteId → primaryId

function _buildMaps() {
  const inParentChild = new Set();
  state.rels.forEach(r => {
    if (r.type === "parent_child") {
      inParentChild.add(r.person1_id);
      inParentChild.add(r.person2_id);
    }
  });

  // Every person is primary unless they are a spouse-only satellite
  state.persons.forEach(p => _primaryIds.add(p.id));

  state.rels.forEach(r => {
    if (r.type !== "spouse") return;
    const p1in = inParentChild.has(r.person1_id);
    const p2in = inParentChild.has(r.person2_id);
    let primary, satellite;
    if (p1in && !p2in)       { primary = r.person1_id; satellite = r.person2_id; }
    else if (p2in && !p1in)  { primary = r.person2_id; satellite = r.person1_id; }
    else if (!p1in && !p2in) { primary = r.person1_id; satellite = r.person2_id; } // rare
    else return; // both in tree = both primary (shouldn't happen)

    _satelliteMap[primary]   = satellite;
    _primaryOf[satellite]    = primary;
    _primaryIds.delete(satellite);
  });
}

// ─────────────────────────────────────────────────────
// Subtree width calculation (primary nodes only)
// ─────────────────────────────────────────────────────
const _widthCache = {};

function _unitWidth(id) {
  // Width of a single primary node + its spouse (if any)
  const hasSp = !!_satelliteMap[id];
  return hasSp ? NW + SGAP + SPOUSE_W : NW;
}

function _subtreeWidth(id) {
  if (_widthCache[id] !== undefined) return _widthCache[id];
  const children = _primaryChildren(id);
  const uw = _unitWidth(id);
  if (!children.length) {
    _widthCache[id] = uw + HGAP;
    return _widthCache[id];
  }
  const childSum = children.reduce((s, c) => s + _subtreeWidth(c.id), 0);
  _widthCache[id] = Math.max(uw + HGAP, childSum);
  return _widthCache[id];
}

// Only primary children (exclude satellite spouses)
function _primaryChildren(id) {
  return getChildren(id).filter(c => _primaryIds.has(c.id));
}

// ─────────────────────────────────────────────────────
// Assign x,y positions to every primary node
// ─────────────────────────────────────────────────────
const _pos = {}; // id → {x, y, cx}  cx = center x of node

function _assignPositions(id, left) {
  const children = _primaryChildren(id);
  const gen = state.pMap[id]?.generation ?? 0;
  const y   = gen * (NH + VGAP);
  const tw  = _subtreeWidth(id);

  // Center this node over its children's span
  let cx;
  if (!children.length) {
    cx = left + _unitWidth(id) / 2;
  } else {
    // lay children out first
    let cl = left;
    for (const c of children) {
      _assignPositions(c.id, cl);
      cl += _subtreeWidth(c.id);
    }
    // center over first..last child
    const firstCX = _pos[children[0].id].cx;
    const lastCX  = _pos[children[children.length - 1].id].cx;
    cx = (firstCX + lastCX) / 2;
  }

  _pos[id] = { x: cx - NW / 2, y, cx };

  // Spouse sits to the right
  const spId = _satelliteMap[id];
  if (spId) {
    _pos[spId] = { x: cx + NW / 2 + SGAP, y, cx: cx + NW / 2 + SGAP + SPOUSE_W / 2 };
  }
}

// ─────────────────────────────────────────────────────
// SVG rendering
// ─────────────────────────────────────────────────────
function _renderTree() {
  const canvas = document.getElementById("tree-canvas");
  canvas.innerHTML = "";

  // Compute total canvas size
  const allX = Object.values(_pos).map(p => p.x);
  const allY = Object.values(_pos).map(p => p.y);
  const minX = Math.min(...allX) - 20;
  const maxX = Math.max(...allX) + NW + 20;
  const minY = Math.min(...allY) - 20;
  const maxY = Math.max(...allY) + NH + 20;
  const W = maxX - minX;
  const H = maxY - minY;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width",  W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `${minX} ${minY} ${W} ${H}`);
  svg.style.display = "block";
  svg.style.overflow = "visible";

  // ── Connector lines (drawn behind nodes) ──
  const lineGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  lineGroup.setAttribute("class", "tree-lines");
  svg.appendChild(lineGroup);

  // Spouse connector lines
  for (const [pid, sid] of Object.entries(_satelliteMap)) {
    const pp = _pos[pid], sp = _pos[sid];
    if (!pp || !sp) continue;
    const x1 = pp.x + NW;
    const x2 = sp.x;
    const y  = pp.y + NH / 2;
    const line = _svgEl("line", { x1, y1: y, x2, y2: y, class: "conn-spouse" });
    lineGroup.appendChild(line);
  }

  // Parent → child connectors
  for (const pid of _primaryIds) {
    const children = _primaryChildren(state.pMap[pid] || { id: pid });
    if (!children.length) continue;
    const pp = _pos[pid]; if (!pp) continue;

    // Drop from parent bottom-center
    const parentCX  = pp.cx;
    const parentBot = pp.y + NH;
    const midY      = parentBot + VGAP * 0.45;

    if (children.length === 1) {
      const cp = _pos[children[0].id]; if (!cp) continue;
      const d = `M ${parentCX} ${parentBot} L ${parentCX} ${midY} L ${cp.cx} ${midY} L ${cp.cx} ${cp.y}`;
      lineGroup.appendChild(_svgEl("path", { d, class: "conn-line", fill: "none" }));
    } else {
      // Horizontal bus + drops
      const firstCX = _pos[children[0].id]?.cx;
      const lastCX  = _pos[children[children.length - 1].id]?.cx;
      if (firstCX == null || lastCX == null) continue;

      // Vertical from parent down to bus
      lineGroup.appendChild(_svgEl("line", { x1: parentCX, y1: parentBot, x2: parentCX, y2: midY, class: "conn-line" }));
      // Horizontal bus
      lineGroup.appendChild(_svgEl("line", { x1: firstCX, y1: midY, x2: lastCX, y2: midY, class: "conn-line" }));
      // Verticals down to each child
      for (const c of children) {
        const cp = _pos[c.id]; if (!cp) continue;
        lineGroup.appendChild(_svgEl("line", { x1: cp.cx, y1: midY, x2: cp.cx, y2: cp.y, class: "conn-line" }));
      }
    }
  }

  // ── Node cards ──
  const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  nodeGroup.setAttribute("class", "tree-nodes");
  svg.appendChild(nodeGroup);

  for (const [id, pos] of Object.entries(_pos)) {
    const p = state.pMap[id]; if (!p) continue;
    const isSatellite = !!_primaryOf[id];
    const w = isSatellite ? SPOUSE_W : NW;
    nodeGroup.appendChild(_makeNodeCard(p, pos.x, pos.y, w, isSatellite));
  }

  canvas.appendChild(svg);
  _initPanZoom(canvas, svg, W, H);
}

function _svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function _makeNodeCard(p, x, y, w, isSatellite) {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "tree-node" + (isSatellite ? " node-spouse" : "") + (p.needs_review ? " node-review" : ""));
  g.setAttribute("data-pid", p.id);
  g.style.cursor = "pointer";

  // Card background
  const rect = _svgEl("rect", {
    x, y, width: w, height: NH, rx: ROUNDING, ry: ROUNDING,
    class: isSatellite ? "node-rect spouse-rect"
         : p.blood_member ? "node-rect blood-rect"
         : "node-rect married-rect"
  });
  g.appendChild(rect);

  // Generation badge (primary only)
  if (!isSatellite) {
    const badge = _svgEl("rect", { x: x + w - 22, y: y + 2, width: 20, height: 14, rx: 4, ry: 4, class: "gen-badge-rect" });
    g.appendChild(badge);
    const genTxt = _svgEl("text", { x: x + w - 12, y: y + 12, class: "gen-badge-txt", "text-anchor": "middle" });
    genTxt.textContent = `G${p.generation ?? "?"}`;
    g.appendChild(genTxt);
  }

  // Name text — wraps at 2 lines
  const name = shortName(p.name);
  const words = name.split(" ");
  const line1 = words.length > 2 ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : name;
  const line2 = words.length > 2 ? words.slice(Math.ceil(words.length / 2)).join(" ") : null;

  const cx = x + w / 2;
  if (line2) {
    const t1 = _svgEl("text", { x: cx, y: y + NH / 2 - 5, class: "node-name", "text-anchor": "middle" });
    t1.textContent = line1;
    g.appendChild(t1);
    const t2 = _svgEl("text", { x: cx, y: y + NH / 2 + 11, class: "node-name", "text-anchor": "middle" });
    t2.textContent = line2;
    g.appendChild(t2);
  } else {
    const t = _svgEl("text", { x: cx, y: y + NH / 2 + 5, class: "node-name", "text-anchor": "middle" });
    t.textContent = line1;
    g.appendChild(t);
  }

  // Deceased indicator
  if (p.is_alive === false) {
    const cross = _svgEl("text", { x: x + 8, y: y + 13, class: "deceased-mark" });
    cross.textContent = "✝";
    g.appendChild(cross);
  }

  // Tap → open profile sheet
  g.addEventListener("click", (e) => {
    e.stopPropagation();
    openSheet(p.id);
  });

  return g;
}

// ─────────────────────────────────────────────────────
// Pan + Zoom (touch + mouse)
// ─────────────────────────────────────────────────────
function _initPanZoom(container, svg, svgW, svgH) {
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, lastX = 0, lastY = 0;
  let lastDist = 0;

  // Fit the tree into the container on first load
  const vw = container.clientWidth  || window.innerWidth;
  const vh = container.clientHeight || (window.innerHeight - 120);
  const fitScale = Math.min(vw / svgW, vh / svgH, 1);
  scale = fitScale;
  tx = (vw - svgW * scale) / 2;
  ty = 16;
  _applyTransform();

  function _applyTransform() {
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    svg.style.transformOrigin = "0 0";
  }

  // Mouse
  container.addEventListener("mousedown", e => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    _applyTransform();
  });
  window.addEventListener("mouseup", () => dragging = false);
  container.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const rect  = container.getBoundingClientRect();
    const ox    = e.clientX - rect.left;
    const oy    = e.clientY - rect.top;
    tx = ox - (ox - tx) * delta;
    ty = oy - (oy - ty) * delta;
    scale = Math.min(Math.max(scale * delta, 0.15), 2.5);
    _applyTransform();
  }, { passive: false });

  // Touch
  container.addEventListener("touchstart", e => {
    if (e.touches.length === 1) {
      dragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      dragging = false;
      lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  container.addEventListener("touchmove", e => {
    e.preventDefault();
    if (e.touches.length === 1 && dragging) {
      tx += e.touches[0].clientX - lastX;
      ty += e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      _applyTransform();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastDist) {
        const delta = dist / lastDist;
        const midX  = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY  = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect  = container.getBoundingClientRect();
        const ox    = midX - rect.left;
        const oy    = midY - rect.top;
        tx = ox - (ox - tx) * delta;
        ty = oy - (oy - ty) * delta;
        scale = Math.min(Math.max(scale * delta, 0.15), 2.5);
        _applyTransform();
      }
      lastDist = dist;
    }
  }, { passive: false });

  container.addEventListener("touchend", e => {
    if (e.touches.length < 2) lastDist = 0;
    if (e.touches.length === 0) dragging = false;
  });
}

// ─────────────────────────────────────────────────────
// Public: init — called by app.js once data is ready
// ─────────────────────────────────────────────────────
export function initTree() {
  _buildMaps();

  // Find root(s)
  const hasParent = new Set(state.rels.filter(r => r.type === "parent_child").map(r => r.person2_id));
  const roots = [..._primaryIds].map(id => state.pMap[id]).filter(p => p && !hasParent.has(p.id));
  roots.sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0));

  // Assign positions — allow multiple roots side by side
  let left = 0;
  for (const root of roots) {
    _assignPositions(root.id, left);
    left += _subtreeWidth(root.id);
  }

  _renderTree();
  _wireSheet();
}

// jumpTo is called from search tab — just open the profile sheet directly
export function jumpTo(id) {
  import("./app.js").then(m => m.switchTab("tree"));
  setTimeout(() => openSheet(id), 150);
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

  // Focus tab — 2 generations up + 1 generation down
  document.getElementById("stab-relatives").innerHTML = _buildFocusView(id);
  document.querySelectorAll(".fv-node[data-pid]").forEach(node => {
    node.addEventListener("click", () => openSheet(node.dataset.pid));
  });

  _prefillOld();
  _setSheetTab("info");
  document.getElementById("sheet-backdrop").classList.add("open");
  document.getElementById("profile-sheet").classList.add("open");
}

// ─────────────────────────────────────────────────────
// Focus mini-view: 2 generations up + selected + 1 generation down
// ─────────────────────────────────────────────────────
function _buildFocusView(id) {
  const person  = state.pMap[id]; if (!person) return "";
  const parent  = getParent(id);
  const grandpa = parent ? getParent(parent.id) : null;

  // Grandparent row (gen -2)
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

  // Parent row (gen -1)
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

  // Selected person + their spouse (centre)
  const spouse   = getSpouse(id);
  const selfRow  = `
    <div class="fv-row fv-row-self">
      <div class="fv-label">Selected</div>
      <div class="fv-nodes">
        ${_fvNode(person, "self")}
        ${spouse ? _fvNode(spouse, "self-sp") : ""}
      </div>
    </div>`;

  // Children row (gen +1)
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
  const isSelf    = role === "self";
  const isSpouse  = role.endsWith("-sp") || role === "self-sp";
  const isChild   = role === "child";
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
