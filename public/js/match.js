// match.js — 🔗 relationship finder
import { state, getParent, getChildren, getSpouse } from "./app.js";
import { cleanName, shortName } from "./utils.js";
import { openSheet } from "./tree.js";

let _selectedA = null;
let _selectedB = null;
let _pickerSlot = null; // "a" | "b"

export function initMatch() {
  document.getElementById("selector-a").addEventListener("click", () => _openPicker("a"));
  document.getElementById("selector-b").addEventListener("click", () => _openPicker("b"));
  document.getElementById("btn-find-relation").addEventListener("click", _findRelation);

  // Picker wiring
  document.getElementById("person-picker").addEventListener("click", e => {
    if (e.target === e.currentTarget) _closePicker();
  });
  document.getElementById("picker-input").addEventListener("input", e => _renderPickerList(e.target.value));
}

// ── Picker ────────────────────────────────────────────
function _openPicker(slot) {
  _pickerSlot = slot;
  document.getElementById("picker-input").value = "";
  _renderPickerList("");
  document.getElementById("person-picker").classList.add("open");
  setTimeout(() => document.getElementById("picker-input").focus(), 150);
}

function _closePicker() {
  document.getElementById("person-picker").classList.remove("open");
}

function _renderPickerList(q) {
  const list = document.getElementById("picker-list");
  const results = state.persons.filter(p => {
    if (!q) return true;
    return cleanName(p.name).toLowerCase().includes(q.toLowerCase()) ||
           (p.current_location || "").toLowerCase().includes(q.toLowerCase());
  }).slice(0, 40);

  list.innerHTML = results.map(p => `
    <div class="picker-item" data-pid="${p.id}">
      <div>
        <div class="pi-name">${cleanName(p.name)}</div>
        <div class="pi-meta">Gen ${p.generation ?? "?"}${p.current_location ? " · " + p.current_location : ""}</div>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".picker-item").forEach(item => {
    item.addEventListener("click", () => {
      const p = state.pMap[item.dataset.pid];
      if (!p) return;
      if (_pickerSlot === "a") {
        _selectedA = p;
        const el = document.getElementById("ms-name-a");
        el.textContent = shortName(p.name);
        el.className = "ms-name";
        document.getElementById("selector-a").classList.add("selected");
      } else {
        _selectedB = p;
        const el = document.getElementById("ms-name-b");
        el.textContent = shortName(p.name);
        el.className = "ms-name";
        document.getElementById("selector-b").classList.add("selected");
      }
      _closePicker();
      document.getElementById("btn-find-relation").disabled = !(_selectedA && _selectedB);
      document.getElementById("relation-result").classList.remove("show");
    });
  });
}

// ── BFS shortest path ─────────────────────────────────
function _bfsPath(startId, endId) {
  if (startId === endId) return [startId];

  // Build adjacency: parent_child (both dirs) + spouse
  const adj = {};
  function add(a, b, label) {
    (adj[a] = adj[a] || []).push({ id: b, label });
  }

  state.rels.forEach(r => {
    if (r.type === "parent_child") {
      add(r.person1_id, r.person2_id, "parent→child");
      add(r.person2_id, r.person1_id, "child→parent");
    } else if (r.type === "spouse") {
      add(r.person1_id, r.person2_id, "spouse");
      add(r.person2_id, r.person1_id, "spouse");
    }
  });

  const visited = new Set([startId]);
  const queue   = [{ id: startId, path: [startId], labels: [] }];

  while (queue.length) {
    const { id, path, labels } = queue.shift();
    const neighbors = adj[id] || [];
    for (const { id: nid, label } of neighbors) {
      if (visited.has(nid)) continue;
      visited.add(nid);
      const newPath   = [...path, nid];
      const newLabels = [...labels, label];
      if (nid === endId) return { path: newPath, labels: newLabels };
      queue.push({ id: nid, path: newPath, labels: newLabels });
    }
  }
  return null;
}

// ── Derive relationship label ─────────────────────────
function _deriveRelation(labels) {
  if (!labels || !labels.length) return "Same person";
  // Simple heuristics
  if (labels.length === 1) {
    if (labels[0] === "spouse")        return "Spouse";
    if (labels[0] === "parent→child")  return "Parent";
    if (labels[0] === "child→parent")  return "Child";
  }
  if (labels.length === 2) {
    if (labels.every(l => l === "child→parent")) return "Grandparent";
    if (labels.every(l => l === "parent→child")) return "Grandchild";
    if (labels[0] === "child→parent" && labels[1] === "parent→child") return "Sibling";
    if (labels[0] === "child→parent" && labels[1] === "spouse") return "Parent's spouse (step-parent)";
    if (labels[0] === "spouse" && labels[1] === "parent→child") return "Spouse's child (step-child)";
  }
  if (labels.length === 3) {
    const up = labels.filter(l => l === "child→parent").length;
    const dn = labels.filter(l => l === "parent→child").length;
    if (up === 3) return "Great-grandparent";
    if (dn === 3) return "Great-grandchild";
    if (up === 2 && dn === 1) return "Uncle / Aunt";
    if (up === 1 && dn === 2) return "Nephew / Niece";
    if (up === 2 && labels[2] === "spouse") return "Uncle/Aunt's spouse";
  }
  if (labels.length === 4) {
    const up = labels.filter(l => l === "child→parent").length;
    const dn = labels.filter(l => l === "parent→child").length;
    if (up === 2 && dn === 2) return "First Cousin";
    if (up === 3 && dn === 1) return "Grand-uncle / Grand-aunt";
    if (up === 1 && dn === 3) return "Grand-nephew / Grand-niece";
  }
  // Fallback: count ups vs downs
  const up = labels.filter(l => l === "child→parent").length;
  const dn = labels.filter(l => l === "parent→child").length;
  if (up && dn) return `${up} generation(s) up, ${dn} down — Cousin / Extended family`;
  if (up) return `${up} generations up (ancestor)`;
  if (dn) return `${dn} generations down (descendant)`;
  return "Related by marriage";
}

// ── Find + render result ──────────────────────────────
function _findRelation() {
  if (!_selectedA || !_selectedB) return;
  const result = document.getElementById("relation-result");

  if (_selectedA.id === _selectedB.id) {
    result.innerHTML = `<div class="rr-header">Same person selected!</div>`;
    result.classList.add("show");
    return;
  }

  const found = _bfsPath(_selectedA.id, _selectedB.id);

  if (!found) {
    result.innerHTML = `
      <div class="rr-header">No connection found 😕</div>
      <p style="font-size:0.82rem;color:var(--muted)">
        These two people don't appear to be connected in the current tree data.
        They may be in separate branches without a recorded link.
      </p>`;
    result.classList.add("show");
    return;
  }

  const { path, labels } = found;
  const relation = _deriveRelation(labels);

  // Build step-by-step path HTML
  const stepsHtml = path.map((id, i) => {
    const p = state.pMap[id];
    const name = p ? cleanName(p.name) : id;
    const isLast = i === path.length - 1;
    const connLabel = labels[i] ? _edgeLabel(labels[i]) : "";

    return `
      <div class="rr-step">
        <span class="step-dot"></span>
        <span style="cursor:pointer;color:var(--brown);text-decoration:underline dotted"
              data-pid="${id}">${name}</span>
        ${p?.generation ? `<span style="font-size:0.68rem;color:var(--muted)">(G${p.generation})</span>` : ""}
      </div>
      ${!isLast ? `<div class="rr-step"><span class="step-line"></span><span style="font-size:0.72rem;color:var(--muted)">${connLabel}</span></div>` : ""}
    `;
  }).join("");

  result.innerHTML = `
    <div class="rr-header">${shortName(_selectedA.name)} → ${shortName(_selectedB.name)}</div>
    <div class="rr-path">${stepsHtml}</div>
    <div class="rr-relation-label">
      Relationship: <strong>${relation}</strong>
      <div style="margin-top:6px;font-size:0.72rem">Path length: ${path.length - 1} step${path.length !== 2 ? "s" : ""}</div>
    </div>
  `;
  result.classList.add("show");

  // Wire name links → open profile sheet
  result.querySelectorAll("[data-pid]").forEach(el => {
    el.addEventListener("click", () => openSheet(el.dataset.pid));
  });
}

function _edgeLabel(label) {
  return label === "parent→child"  ? "↓ parent of"  :
         label === "child→parent"  ? "↑ child of"   :
         label === "spouse"        ? "💍 married to" :
         label;
}
