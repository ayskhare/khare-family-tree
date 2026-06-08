// tree.js — 🌳 tree render + navigation + profile sheet
import { state, getSpouse, getParent, getChildren, getSiblings, findRoot, buildPath } from "./app.js";
import { cleanName, shortName, fmtDate, showToast } from "./utils.js";
import { postComment, postChangeRequest } from "./api.js";

// ── Tree navigation state ─────────────────────────────
let focusId   = null;
let navHistory = [];
let animDir   = "fade";

// ── Profile sheet state ───────────────────────────────
let sheetPid  = null;

// ─────────────────────────────────────────────────────
// Public: called by app.js once data is ready
// ─────────────────────────────────────────────────────
export function initTree() {
  const root = findRoot();
  if (!root) return;
  focusId    = root.id;
  navHistory = [];
  animDir    = "fade";
  renderFocus();
  renderBreadcrumb();
  _wireSheet();
}

// ─────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────
function navTo(id, dir) {
  animDir = dir;
  if (dir === "down") navHistory.push(focusId);
  else if (dir === "up") {
    const idx = navHistory.indexOf(id);
    navHistory = idx !== -1 ? navHistory.slice(0, idx) : navHistory.slice(0, -1);
  }
  focusId = id;
  renderFocus();
  renderBreadcrumb();
}

// Called externally (e.g., from search) to jump to a person
export function jumpTo(id) {
  navHistory = buildPath(id);
  focusId    = id;
  animDir    = "fade";
  renderFocus();
  renderBreadcrumb();
  // Switch to tree tab
  import("./app.js").then(m => m.switchTab("tree"));
}

// ─────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────
export function renderFocus() {
  const focus    = state.pMap[focusId]; if (!focus) return;
  const parent   = getParent(focusId);
  const spouse   = getSpouse(focusId);
  const children = getChildren(focusId);
  const siblings = getSiblings(focusId);

  const animClass = animDir === "down" ? "anim-up" : animDir === "up" ? "anim-down" : "anim-fade";

  // — parent row —
  const rp = document.getElementById("row-parent");
  rp.innerHTML = "";
  const ct = document.getElementById("conn-top");
  if (parent) {
    rp.appendChild(_makeCard(parent, "parent", animClass));
    ct.style.display = "block";
  } else {
    ct.style.display = "none";
  }

  // — focus + spouse row —
  const rf = document.getElementById("row-focus");
  rf.innerHTML = "";
  const pair = document.createElement("div");
  pair.className = "card-pair";
  pair.appendChild(_makeCard(focus, "focus", animClass));
  if (spouse) {
    const line = document.createElement("div");
    line.className = "spouse-line";
    pair.appendChild(line);
    pair.appendChild(_makeCard(spouse, "spouse", animClass));
  }
  rf.appendChild(pair);

  // — siblings strip —
  const ss = document.getElementById("siblings-strip");
  ss.innerHTML = "";
  if (siblings.length) {
    ss.style.display = "flex";
    const lbl = document.createElement("span");
    lbl.className = "sib-label";
    lbl.textContent = "Siblings:";
    ss.appendChild(lbl);
    siblings.forEach(s => {
      const chip = document.createElement("div");
      chip.className = "sib-chip";
      chip.textContent = shortName(s.name);
      chip.addEventListener("click", () => {
        animDir    = "fade";
        navHistory = buildPath(s.id);
        focusId    = s.id;
        renderFocus();
        renderBreadcrumb();
      });
      ss.appendChild(chip);
    });
  } else {
    ss.style.display = "none";
  }

  // — children —
  const cr = document.getElementById("children-row");
  cr.innerHTML = "";
  const cm = document.getElementById("conn-mid");
  if (children.length) {
    cm.style.display = "block";
    children.forEach(c => cr.appendChild(_makeCard(c, "child", animClass)));
  } else {
    cm.style.display = "none";
  }
}

function renderBreadcrumb() {
  const bc = document.getElementById("tree-breadcrumb");
  bc.innerHTML = "";
  [...navHistory, focusId].filter(Boolean).forEach((id, i, arr) => {
    const p = state.pMap[id]; if (!p) return;
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "›";
      bc.appendChild(sep);
    }
    const el = document.createElement("span");
    el.className = "bc-item" + (i === arr.length - 1 ? " active" : "");
    el.textContent = shortName(p.name);
    if (i < arr.length - 1) el.addEventListener("click", () => navTo(id, "up"));
    bc.appendChild(el);
  });
  bc.scrollLeft = bc.scrollWidth;
}

// ─────────────────────────────────────────────────────
// Card factory
// ─────────────────────────────────────────────────────
function _makeCard(p, type, animClass) {
  const el = document.createElement("div");
  el.className = `tree-card ${type}-card${p.needs_review ? " needs-review" : ""} ${animClass}`;

  el.innerHTML = `
    <div class="card-gen">G${p.generation ?? "?"}</div>
    <div class="card-name">${shortName(p.name)}</div>
    ${p.current_location && type !== "child" ? `<div class="card-meta">📍 ${p.current_location}</div>` : ""}
  `;

  // Long-press → profile sheet
  let pt;
  el.addEventListener("touchstart", () => { pt = setTimeout(() => openSheet(p.id), 500); }, { passive: true });
  el.addEventListener("touchend",   () => clearTimeout(pt));
  el.addEventListener("touchmove",  () => clearTimeout(pt));

  // Tap behaviour by type
  if (type === "parent")  el.addEventListener("click", () => navTo(p.id, "up"));
  else if (type === "child") el.addEventListener("click", () => navTo(p.id, "down"));
  else el.addEventListener("click", () => openSheet(p.id)); // focus or spouse

  return el;
}

// ─────────────────────────────────────────────────────
// Profile sheet
// ─────────────────────────────────────────────────────
export function openSheet(id) {
  sheetPid = id;
  const p  = state.pMap[id]; if (!p) return;

  // Name + meta
  document.getElementById("sheet-name").textContent = cleanName(p.name);
  document.getElementById("sheet-meta").innerHTML   =
    `<span>Generation ${p.generation ?? "?"}</span>` +
    `<span>${p.blood_member ? "Khare bloodline" : "Married in"}</span>`;

  // Badges
  const badges = document.getElementById("sheet-badges");
  badges.innerHTML =
    (p.blood_member ? `<span class="sheet-badge badge-blood">🩸 Khare</span>` : `<span class="sheet-badge badge-married">💍 Married in</span>`) +
    (p.gender === "F" ? `<span class="sheet-badge badge-female">♀ Female</span>` : p.gender === "M" ? `<span class="sheet-badge badge-male">♂ Male</span>` : "") +
    (p.is_alive === false ? `<span class="sheet-badge badge-deceased">🕊️ Deceased</span>` : "") +
    (p.needs_review ? `<span class="sheet-badge badge-review">⚠️ Needs review</span>` : "");

  // Info tab
  const spouse   = getSpouse(id);
  const parent   = getParent(id);
  const children = getChildren(id);
  const pc       = state.comments.filter(c => c.person_id === id);

  const rows = [
    ["Name",       cleanName(p.name)],
    ["Gender",     p.gender === "M" ? "♂ Male" : p.gender === "F" ? "♀ Female" : "—"],
    ["Generation", `Gen ${p.generation ?? "?"}`],
    ["Location",   p.current_location || "—"],
    ["Birth date", fmtDate(p.birth_date, true)],
    ["Status",     p.is_alive !== false ? "Living" : "Deceased"],
    ["Lineage",    p.blood_member ? "Khare bloodline" : "Married in"],
  ];
  if (spouse) rows.push(["Spouse", cleanName(spouse.name)]);
  if (parent) rows.push(["Parent", cleanName(parent.name)]);
  if (children.length) rows.push(["Children", children.map(c => shortName(c.name)).join(", ")]);
  if (p.notes) rows.push(["Notes", p.notes]);

  let infoHtml = rows.map(([l, v]) =>
    `<div class="info-row"><span class="info-label">${l}</span><span class="info-value">${v}</span></div>`
  ).join("");

  if (pc.length) {
    infoHtml += `<div style="margin-top:16px">
      <div style="font-size:0.67rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px">💬 Comments</div>
      ${pc.map(c => `
        <div class="comment-card">
          <div class="comment-author">${c.commenter_name}</div>
          <div class="comment-text">${c.content}</div>
          <div class="comment-date">${c.created_at?.slice(0, 10)}</div>
        </div>
      `).join("")}
    </div>`;
  }
  document.getElementById("stab-info").innerHTML = infoHtml;

  // Relatives tab
  let relHtml = `<div class="relatives-grid">`;
  if (parent) relHtml += _relCard(parent, "Parent");
  if (spouse) relHtml += _relCard(spouse, "Spouse");
  const sibs = getSiblings(id);
  sibs.slice(0, 4).forEach(s => relHtml += _relCard(s, "Sibling"));
  children.slice(0, 6).forEach(c => relHtml += _relCard(c, "Child"));
  relHtml += `</div>`;
  if (!parent && !spouse && !sibs.length && !children.length) {
    relHtml = `<p style="color:var(--muted);font-size:0.82rem;padding:16px 0">No relatives found.</p>`;
  }
  document.getElementById("stab-relatives").innerHTML = relHtml;
  // Wire relative card clicks
  document.querySelectorAll(".relative-card[data-pid]").forEach(card => {
    card.addEventListener("click", () => {
      closeSheet();
      setTimeout(() => jumpTo(card.dataset.pid), 300);
    });
  });

  // Prefill suggest field
  _prefillOld();

  _setSheetTab("info");
  document.getElementById("sheet-backdrop").classList.add("open");
  document.getElementById("profile-sheet").classList.add("open");
}

function _relCard(p, rel) {
  return `<div class="relative-card" data-pid="${p.id}">
    <div class="rc-rel">${rel}</div>
    <div class="rc-name">${shortName(p.name)}</div>
  </div>`;
}

function closeSheet() {
  document.getElementById("profile-sheet").classList.remove("open");
  document.getElementById("sheet-backdrop").classList.remove("open");
}

function _setSheetTab(name) {
  document.querySelectorAll(".sheet-tab").forEach(t => t.classList.toggle("active", t.dataset.stab === name));
  document.querySelectorAll(".sheet-tab-panel").forEach(p => p.classList.toggle("active", p.id === `stab-${name}`));
}

function _prefillOld() {
  if (!sheetPid) return;
  const p = state.pMap[sheetPid]; if (!p) return;
  const f = document.getElementById("s-field")?.value;
  if (f) document.getElementById("s-old").value = p[f] || "";
}

function _wireSheet() {
  // Tab switching
  document.querySelectorAll(".sheet-tab").forEach(btn => {
    btn.addEventListener("click", () => _setSheetTab(btn.dataset.stab));
  });
  // Suggest field change → prefill old
  document.getElementById("s-field")?.addEventListener("change", _prefillOld);
  // Backdrop + handle close
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);

  // Submit comment
  document.getElementById("btn-submit-comment")?.addEventListener("click", async () => {
    const name    = document.getElementById("c-name").value.trim();
    const email   = document.getElementById("c-email").value.trim();
    const content = document.getElementById("c-content").value.trim();
    if (!name || !content) { showToast("Name and comment are required."); return; }
    try {
      await postComment({ person_id: sheetPid, commenter_name: name, commenter_email: email, content });
      showToast("✅ Comment submitted — pending approval!");
      document.getElementById("c-name").value = "";
      document.getElementById("c-content").value = "";
      closeSheet();
    } catch (e) { showToast("❌ " + e.message); }
  });

  // Submit suggestion
  document.getElementById("btn-submit-suggest")?.addEventListener("click", async () => {
    const name    = document.getElementById("s-name").value.trim();
    const email   = document.getElementById("s-email").value.trim();
    const field   = document.getElementById("s-field").value;
    const old_val = document.getElementById("s-old").value;
    const new_val = document.getElementById("s-new").value.trim();
    if (!name || !new_val) { showToast("Name and correct value are required."); return; }
    try {
      await postChangeRequest({ person_id: sheetPid, requested_by_name: name, requested_by_email: email, field_name: field, old_value: old_val, new_value: new_val });
      showToast("✅ Suggestion submitted — thank you!");
      document.getElementById("s-new").value = "";
      closeSheet();
    } catch (e) { showToast("❌ " + e.message); }
  });
}
