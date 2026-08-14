// tree.js — 🌳 Focused org-chart tree navigator + profile sheet
import { state, getSpouse, getParent, getChildren } from "./app.js";
import { cleanName, shortName, fmtDate, showToast } from "./utils.js";
import { postComment, postChangeRequest } from "./api.js";

// ─────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────
let _sheetPid = null; // person shown in the profile sheet
let _focusId  = null; // person currently centered in the Tree tab
let _homeId   = null; // default anchor person (Ayush Khare)

// ─────────────────────────────────────────────────────
// Public: init — called by app.js once data is ready
// ─────────────────────────────────────────────────────
export function initTree() {
  _homeId  = _findHomePerson();
  _focusId = _homeId;
  _renderFocusTree(_focusId);
  _wireSheet();
}

// Find the default focus person: "Ayush Khare". Since more than one
// person can share a name in the tree, prefer the one whose parent is
// "Arun Khare" (matches known family history). Falls back gracefully.
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
  // Fallback: youngest-generation blood member, else first person
  const fallback = [...state.persons]
    .filter(p => p.blood_member)
    .sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0))[0];
  return (fallback || state.persons[0])?.id ?? null;
}

// jumpTo — used by the Search tab to focus the tree on a specific person
export function jumpTo(id) {
  import("./app.js").then(m => m.switchTab("tree"));
  setTimeout(() => {
    _focusId = id;
    _renderFocusTree(id);
  }, 150);
}

// ─────────────────────────────────────────────────────
// Focus tree renderer (grandparents → parents → self+spouse → children)
// ─────────────────────────────────────────────────────
function _renderFocusTree(id) {
  const canvas = document.getElementById("tree-canvas");
  if (!canvas) return;
  const person = state.pMap[id];

  if (!person) {
    canvas.innerHTML = `<div class="empty-state">
      <div class="es-icon">🌳</div>
      <div class="es-title">No family data found</div>
    </div>`;
    return;
  }

  canvas.innerHTML = `
    <div class="tree-toolbar">
      <button class="tree-home-btn" id="tree-home-btn" ${id === _homeId ? "disabled" : ""}>🏠 Home</button>
      <div class="tree-toolbar-name">${cleanName(person.name)}</div>
      <button class="tree-info-btn" id="tree-info-btn">ℹ️ Profile</button>
    </div>
    <div class="tree-focus-scroll">
      ${_buildFocusView(id)}
    </div>
  `;

  canvas.querySelector("#tree-home-btn")?.addEventListener("click", () => {
    _focusId = _homeId;
    _renderFocusTree(_homeId);
  });
  canvas.querySelector("#tree-info-btn")?.addEventListener("click", () => openSheet(id));

  // Tapping any relative card in the tree navigates the focus (org-chart style)
  canvas.querySelectorAll(".fv-node[data-pid]").forEach(node => {
    node.addEventListener("click", () => {
      const pid = node.dataset.pid;
      _focusId = pid;
      _renderFocusTree(pid);
    });
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

  // Relatives tab — reuse the same focus-view widget, but clicking here
  // opens the full profile instead of re-navigating the Tree tab.
  document.getElementById("stab-relatives").innerHTML = _buildFocusView(id);
  document.querySelectorAll("#stab-relatives .fv-node[data-pid]").forEach(node => {
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

  const spouse   = getSpouse(id);
  const selfRow  = `
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
  const isSelf    = role === "self";
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
