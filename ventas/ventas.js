import { createSupabaseClient } from "../shared/js/supabase-config.js";
import { escapeHtml } from "../shared/js/dom-utils.js";
import { todayLocalISODate, formatDateDisplay } from "../shared/js/date-utils.js";
import { driveFileId, driveImageUrl } from "../shared/js/drive-utils.js";

const TABLE_STORES = "rabbit3d_stores";
const TABLE_MODELS = "rabbit3d_keychain_models";
const TABLE_VISITS = "rabbit3d_restock_visits";
const TABLE_ITEMS = "rabbit3d_restock_items";

const sb = createSupabaseClient();

// ---------------------------------------------------------------
// CÓDIGO DE ACCESO (sin usuario/contraseña — un código por empleado)
// ---------------------------------------------------------------
const pinScreen = document.getElementById("pinScreen");
const panelScreen = document.getElementById("panelScreen");
let currentEmployee = null;

document.getElementById("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("pinStatus");
  const code = document.getElementById("pin_code").value.trim();
  if (!/^[0-9]{4}$/.test(code)) {
    status.className = "status err";
    status.textContent = "Ingresá los 4 números de tu código.";
    return;
  }
  status.className = "status busy";
  status.textContent = "Verificando…";

  const { data, error } = await sb.rpc("verify_employee_pin", { p_code: code });
  if (error || !data || !data.length) {
    status.className = "status err";
    status.textContent = "Código incorrecto. Probá de nuevo.";
    return;
  }

  currentEmployee = data[0];
  sessionStorage.setItem("rabbit3d_employee", JSON.stringify(currentEmployee));
  enterPanel();
});

// Sesión guardada en este navegador — sin botón visible de "Salir" (si
// alguna vez hace falta cerrarla a mano, basta con borrar el storage del
// sitio desde el navegador).
function logoutEmployee() {
  sessionStorage.removeItem("rabbit3d_employee");
  location.reload();
}

let employeesBasicCache = [];

function canEditStore(store) {
  if (!store) return false;
  if (currentEmployee.is_admin) return true;
  return store.employee_id != null && Number(store.employee_id) === Number(currentEmployee.id);
}

function applyPermissionsUI() {
  const isAdmin = !!currentEmployee.is_admin;
  // "Locales": todos pueden agregar uno nuevo; solo el admin puede elegir
  // a quién asignarlo (a los demás, se les asigna a sí mismos solo).
  document.getElementById("storeFormCard").style.display = "block";
  document.getElementById("storeFormLockedHint").style.display = "none";
  document.getElementById("store_employee").style.display = isAdmin ? "block" : "none";
  document.getElementById("store_employee_self_hint").style.display = isAdmin ? "none" : "block";

  document.getElementById("modelFormCard").style.display = isAdmin ? "block" : "none";
  document.getElementById("modelFormLockedHint").style.display = isAdmin ? "none" : "block";
}

async function loadEmployeesBasic() {
  const { data, error } = await sb.rpc("list_employees_basic");
  employeesBasicCache = error ? [] : data;
  const select = document.getElementById("store_employee");
  const keep = select.value;
  select.innerHTML =
    `<option value="">Sin asignar</option>` +
    employeesBasicCache.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  if (keep) select.value = keep;
}

async function enterPanel() {
  pinScreen.style.display = "none";
  panelScreen.style.display = "block";
  document.getElementById("employeeNameLabel").textContent = currentEmployee.name + (currentEmployee.is_admin ? " (administrador)" : "");
  document.getElementById("visit_date").value = todayLocalISODate();
  applyPermissionsUI();
  await loadEmployeesBasic();
  await loadModels();
  cancelEditVisit();
  await loadStores(); // esta ya llama a loadVisits() al final, con modelsCache listo
}

// Si ya habías entrado en esta pestaña del navegador, no pide el código de nuevo.
const savedEmployee = sessionStorage.getItem("rabbit3d_employee");
if (savedEmployee) {
  currentEmployee = JSON.parse(savedEmployee);
  enterPanel();
}

// ---------------------------------------------------------------
// TABS (incluye la navegación inferior de celular, que usa la misma lógica)
// ---------------------------------------------------------------
function switchMainTab(tabName) {
  document.querySelectorAll(".tabs .tab[data-tab]").forEach((t) => t.classList.remove("is-active"));
  document.querySelector(`.tabs .tab[data-tab="${tabName}"]`)?.classList.add("is-active");
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  document.getElementById(`panel-${tabName}`).classList.add("is-active");

  document.querySelectorAll("#bottomNav [data-nav-tab]").forEach((b) => b.classList.remove("is-active"));
  document.querySelector(`#bottomNav [data-nav-tab="${tabName}"]`)?.classList.add("is-active");

  if (tabName === "estadisticas") renderStats();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tabs .tab[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => switchMainTab(tab.dataset.tab));
});
document.querySelectorAll("#bottomNav [data-nav-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchMainTab(btn.dataset.navTab));
});

// ---------------------------------------------------------------
// LOCALES
// ---------------------------------------------------------------
let storesCache = [];
let editingStoreId = null;

function cancelEditStore() {
  editingStoreId = null;
  document.getElementById("storeForm").reset();
  document.getElementById("store_active").checked = true;
  document.getElementById("store_form_title").textContent = "Nuevo local";
  document.getElementById("store_cancel_edit").style.display = "none";
  document.getElementById("store_submit").textContent = "Guardar local";
}
document.getElementById("store_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditStore();
});

function startEditStore(row) {
  editingStoreId = row.id;
  document.getElementById("store_name").value = row.name;
  document.getElementById("store_notes").value = row.notes || "";
  document.getElementById("store_active").checked = !!row.active;
  document.getElementById("store_employee").value = row.employee_id || "";
  document.getElementById("store_form_title").textContent = "Editando local";
  document.getElementById("store_cancel_edit").style.display = "inline-block";
  document.getElementById("store_submit").textContent = "Guardar cambios";
  document.getElementById("panel-locales").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("storeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("store_status");
  const submitBtn = document.getElementById("store_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";
    const payload = {
      name: document.getElementById("store_name").value.trim(),
      notes: document.getElementById("store_notes").value.trim() || null,
      active: document.getElementById("store_active").checked,
      employee_id: currentEmployee.is_admin ? document.getElementById("store_employee").value || null : currentEmployee.id,
    };
    const { error } = editingStoreId
      ? await sb.from(TABLE_STORES).update(payload).eq("id", editingStoreId)
      : await sb.from(TABLE_STORES).insert(payload);
    if (error) throw error;
    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditStore();
    await loadStores();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadStores() {
  const { data, error } = await sb.from(TABLE_STORES).select("*").order("sort_order", { ascending: true }).order("id", { ascending: true });
  storesCache = error ? [] : data;

  const isAdmin = !!currentEmployee.is_admin;
  const tbody = document.getElementById("storesTableBody");
  const cardsList = document.getElementById("storesList");
  tbody.innerHTML = "";
  cardsList.innerHTML = "";
  storesCache.forEach((s) => {
    const employeeName = employeesBasicCache.find((e) => Number(e.id) === Number(s.employee_id))?.name || "Sin asignar";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(employeeName)}</td>
      <td>${escapeHtml(s.notes || "—")}</td>
      <td>${s.active ? "Sí" : "No"}</td>
      <td class="row-actions">
        ${
          isAdmin
            ? `<button class="btn btn-edit" data-edit-store="${s.id}">Editar</button>
               <button class="btn btn-danger" data-delete-store="${s.id}">Borrar</button>`
            : ""
        }
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "simple-card";
    card.innerHTML = `
      <div class="simple-card-info">
        <div class="simple-card-title">${escapeHtml(s.name)}</div>
        <div class="simple-card-meta">${escapeHtml(employeeName)}${s.notes ? " · " + escapeHtml(s.notes) : ""}</div>
      </div>
      <span class="simple-card-badge ${s.active ? "is-active" : ""}">${s.active ? "Activo" : "Inactivo"}</span>
      ${
        isAdmin
          ? `<div class="simple-card-actions">
               <button data-edit-store="${s.id}" aria-label="Editar">✏️</button>
               <button data-delete-store="${s.id}" aria-label="Borrar">🗑️</button>
             </div>`
          : ""
      }
    `;
    cardsList.appendChild(card);
  });

  // Selector de local en el formulario de reposición: solo los que el
  // empleado actual puede editar (o todos, si es administrador).
  const editableStores = storesCache.filter((s) => s.active && canEditStore(s));
  const select = document.getElementById("visit_store");
  const keep = select.value;
  select.innerHTML = editableStores.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  if (keep) select.value = keep;

  const noStoresHint = document.getElementById("visit_no_stores_hint");
  const canAddVisit = editableStores.length > 0;
  document.getElementById("visit_submit").style.display = canAddVisit ? "inline-flex" : "none";
  document.getElementById("visit_add_item").style.display = canAddVisit ? "inline-flex" : "none";
  noStoresHint.style.display = canAddVisit ? "none" : "block";

  // Pestañas de filtro por local en el historial (todos los locales,
  // para poder ver — no solo los propios).
  const filterWrap = document.getElementById("visit_store_filter");
  const activeFilter = filterWrap.querySelector(".tab.is-active")?.dataset.storeFilter || "todos";
  filterWrap.innerHTML = `<button class="tab ${activeFilter === "todos" ? "is-active" : ""}" data-store-filter="todos">Todos los locales</button>`;
  storesCache.forEach((s) => {
    filterWrap.innerHTML += `<button class="tab ${activeFilter === String(s.id) ? "is-active" : ""}" data-store-filter="${s.id}">${escapeHtml(s.name)}</button>`;
  });
  filterWrap.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      filterWrap.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      loadVisits();
    });
  });

  await loadVisits();
}

async function handleStoreListClick(e) {
  const editBtn = e.target.closest("[data-edit-store]");
  if (editBtn) {
    const row = storesCache.find((r) => String(r.id) === editBtn.dataset.editStore);
    if (row) startEditStore(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-store]");
  if (delBtn) {
    if (!confirm("¿Borrar este local? También se borran sus reposiciones cargadas.")) return;
    await sb.from(TABLE_STORES).delete().eq("id", delBtn.dataset.deleteStore);
    loadStores();
  }
}
document.getElementById("storesTableBody").addEventListener("click", handleStoreListClick);
document.getElementById("storesList").addEventListener("click", handleStoreListClick);

// ---------------------------------------------------------------
// MODELOS
// ---------------------------------------------------------------
let modelsCache = [];
let editingModelId = null;

function cancelEditModel() {
  editingModelId = null;
  document.getElementById("modelForm").reset();
  document.getElementById("model_active").checked = true;
  document.getElementById("model_image_preview_wrap").style.display = "none";
  document.getElementById("model_form_title").textContent = "Nuevo modelo";
  document.getElementById("model_cancel_edit").style.display = "none";
  document.getElementById("model_submit").textContent = "Guardar modelo";
}
document.getElementById("model_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditModel();
});

function startEditModel(row) {
  editingModelId = row.id;
  document.getElementById("model_name").value = row.name;
  document.getElementById("model_description").value = row.description || "";
  document.getElementById("model_image_url").value = row.image_path || "";
  document.getElementById("model_active").checked = !!row.active;
  const previewWrap = document.getElementById("model_image_preview_wrap");
  if (row.image_path) {
    document.getElementById("model_image_preview").src = row.image_path;
    previewWrap.style.display = "block";
  } else {
    previewWrap.style.display = "none";
  }
  document.getElementById("model_form_title").textContent = "Editando modelo";
  document.getElementById("model_cancel_edit").style.display = "inline-block";
  document.getElementById("model_submit").textContent = "Guardar cambios";
  document.getElementById("panel-modelos").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("model_image_load").addEventListener("click", () => {
  const status = document.getElementById("model_status");
  const raw = document.getElementById("model_image_url").value.trim();
  const direct = driveImageUrl(raw);
  const wrap = document.getElementById("model_image_preview_wrap");
  if (!direct) {
    wrap.style.display = "none";
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  document.getElementById("model_image_preview").src = direct;
  wrap.style.display = "block";
});

document.getElementById("modelForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("model_status");
  const submitBtn = document.getElementById("model_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const rawImageUrl = document.getElementById("model_image_url").value.trim();
    let imagePath = null;
    if (rawImageUrl) {
      imagePath = driveImageUrl(rawImageUrl);
      if (!imagePath) {
        status.className = "status err";
        status.textContent = "No pude leer el link de Drive de la foto — revisalo, o dejá el campo vacío.";
        return;
      }
    }

    const payload = {
      name: document.getElementById("model_name").value.trim(),
      description: document.getElementById("model_description").value.trim() || null,
      image_path: imagePath,
      active: document.getElementById("model_active").checked,
    };
    const { error } = editingModelId
      ? await sb.from(TABLE_MODELS).update(payload).eq("id", editingModelId)
      : await sb.from(TABLE_MODELS).insert(payload);
    if (error) throw error;
    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditModel();
    await loadModels();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadModels() {
  const { data, error } = await sb.from(TABLE_MODELS).select("*").order("sort_order", { ascending: true }).order("id", { ascending: true });
  modelsCache = error ? [] : data;

  const isAdmin = !!currentEmployee.is_admin;
  const tbody = document.getElementById("modelsTableBody");
  const cardsList = document.getElementById("modelsList");
  tbody.innerHTML = "";
  cardsList.innerHTML = "";
  modelsCache.forEach((m) => {
    const thumb = m.image_path
      ? `<img src="${m.image_path}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:10px;">`
      : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${thumb}</td>
      <td>${escapeHtml(m.name)}${m.description ? `<div class="hint" style="margin-top:2px">${escapeHtml(m.description)}</div>` : ""}</td>
      <td>${m.active ? "Sí" : "No"}</td>
      <td class="row-actions">
        ${
          isAdmin
            ? `<button class="btn btn-edit" data-edit-model="${m.id}">Editar</button>
               <button class="btn btn-danger" data-delete-model="${m.id}">Borrar</button>`
            : ""
        }
      </td>`;
    tbody.appendChild(tr);

    const card = document.createElement("div");
    card.className = "simple-card";
    card.innerHTML = `
      ${m.image_path ? `<img src="${m.image_path}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:12px;flex-shrink:0;">` : ""}
      <div class="simple-card-info">
        <div class="simple-card-title">${escapeHtml(m.name)}</div>
        ${m.description ? `<div class="simple-card-meta">${escapeHtml(m.description)}</div>` : ""}
      </div>
      <span class="simple-card-badge ${m.active ? "is-active" : ""}">${m.active ? "Activo" : "Inactivo"}</span>
      ${
        isAdmin
          ? `<div class="simple-card-actions">
               <button data-edit-model="${m.id}" aria-label="Editar">✏️</button>
               <button data-delete-model="${m.id}" aria-label="Borrar">🗑️</button>
             </div>`
          : ""
      }
    `;
    cardsList.appendChild(card);
  });
}

async function handleModelListClick(e) {
  const editBtn = e.target.closest("[data-edit-model]");
  if (editBtn) {
    const row = modelsCache.find((r) => String(r.id) === editBtn.dataset.editModel);
    if (row) startEditModel(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-model]");
  if (delBtn) {
    if (!confirm("¿Borrar este modelo? También se borra de las reposiciones ya cargadas.")) return;
    await sb.from(TABLE_MODELS).delete().eq("id", delBtn.dataset.deleteModel);
    loadModels();
  }
}
document.getElementById("modelsTableBody").addEventListener("click", handleModelListClick);
document.getElementById("modelsList").addEventListener("click", handleModelListClick);

function modelOptionsHtml(selectedId) {
  const options = modelsCache.filter((m) => m.active || String(m.id) === String(selectedId));
  if (!options.length) {
    return `<option value="" disabled selected>Cargá un modelo primero en la pestaña "Modelos"</option>`;
  }
  return options
    .map((m) => `<option value="${m.id}" ${String(m.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");
}

// ---------------------------------------------------------------
// REPOSICIONES (visitas + ítems por modelo)
// ---------------------------------------------------------------
let editingVisitId = null;
let visitLineCounter = 0;

function addVisitItemRow(modelId, sold, dropped) {
  const id = ++visitLineCounter;
  const container = document.getElementById("visit_items");
  const row = document.createElement("div");
  row.className = "visit-item-row";
  row.dataset.lineId = id;
  row.innerHTML = `
    <select class="vi-model">${modelOptionsHtml(modelId)}</select>
    <input type="number" class="vi-sold" min="0" step="1" placeholder="Vendidos" value="${sold ?? ""}">
    <input type="number" class="vi-dropped" min="0" step="1" placeholder="Deja ahora" value="${dropped ?? ""}">
    <button type="button" class="btn btn-danger btn-small" data-remove-visit-item="${id}">×</button>
  `;
  container.appendChild(row);
}
document.getElementById("visit_add_item").addEventListener("click", () => addVisitItemRow());
document.getElementById("visit_items").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-visit-item]");
  if (btn) btn.closest(".visit-item-row").remove();
});

function cancelEditVisit() {
  editingVisitId = null;
  document.getElementById("visitForm").reset();
  document.getElementById("visit_date").value = todayLocalISODate();
  document.getElementById("visit_items").innerHTML = "";
  addVisitItemRow();
  document.getElementById("visit_form_title").textContent = "Nueva reposición";
  document.getElementById("visit_cancel_edit").style.display = "none";
  document.getElementById("visit_submit").textContent = "Guardar reposición";
}
document.getElementById("visit_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditVisit();
});

function startEditVisit(visit) {
  editingVisitId = visit.id;
  document.getElementById("visit_store").value = visit.store_id;
  document.getElementById("visit_date").value = visit.visit_date;
  document.getElementById("visit_notes").value = visit.notes || "";
  document.getElementById("visit_items").innerHTML = "";
  const items = visit.rabbit3d_restock_items || [];
  if (items.length) {
    items.forEach((it) => addVisitItemRow(it.model_id, it.quantity_sold, it.quantity_dropped));
  } else {
    addVisitItemRow();
  }
  document.getElementById("visit_form_title").textContent = "Editando reposición";
  document.getElementById("visit_cancel_edit").style.display = "inline-block";
  document.getElementById("visit_submit").textContent = "Guardar cambios";
  document.getElementById("panel-reposiciones").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("visitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("visit_status");
  const submitBtn = document.getElementById("visit_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const chosenStoreId = Number(document.getElementById("visit_store").value);
    const chosenStore = storesCache.find((s) => s.id === chosenStoreId);
    if (!canEditStore(chosenStore)) {
      status.className = "status err";
      status.textContent = "Ese local no está asignado a tu usuario.";
      return;
    }

    const rows = Array.from(document.querySelectorAll("#visit_items .visit-item-row"));
    const items = rows
      .map((row) => ({
        model_id: Number(row.querySelector(".vi-model").value),
        quantity_sold: Number(row.querySelector(".vi-sold").value) || 0,
        quantity_dropped: Number(row.querySelector(".vi-dropped").value) || 0,
      }))
      .filter((it) => it.model_id);

    if (!items.length) {
      status.className = "status err";
      status.textContent = "Agregá al menos un modelo.";
      return;
    }

    const visitPayload = {
      store_id: chosenStoreId,
      employee_id: currentEmployee.id,
      employee_name: currentEmployee.name,
      visit_date: document.getElementById("visit_date").value,
      notes: document.getElementById("visit_notes").value.trim() || null,
    };

    let visitId = editingVisitId;
    if (editingVisitId) {
      const { error } = await sb.from(TABLE_VISITS).update(visitPayload).eq("id", editingVisitId);
      if (error) throw error;
      await sb.from(TABLE_ITEMS).delete().eq("visit_id", editingVisitId);
    } else {
      const { data, error } = await sb.from(TABLE_VISITS).insert(visitPayload).select().single();
      if (error) throw error;
      visitId = data.id;
    }

    const itemsPayload = items.map((it) => ({ ...it, visit_id: visitId }));
    const { error: itemsError } = await sb.from(TABLE_ITEMS).insert(itemsPayload);
    if (itemsError) throw itemsError;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditVisit();
    await loadVisits();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

let visitsCache = [];

async function loadVisits() {
  const { data, error } = await sb
    .from(TABLE_VISITS)
    .select("*, rabbit3d_restock_items(*)")
    .order("visit_date", { ascending: false })
    .order("id", { ascending: false });
  visitsCache = error ? [] : data;

  const list = document.getElementById("visitsList");
  const filter = document.getElementById("visit_store_filter").querySelector(".tab.is-active")?.dataset.storeFilter || "todos";
  const rows = filter === "todos" ? visitsCache : visitsCache.filter((v) => String(v.store_id) === filter);

  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = `<p class="hint">Todavía no hay reposiciones cargadas.</p>`;
    return;
  }

  rows.forEach((visit) => {
    const store = storesCache.find((s) => s.id === visit.store_id);
    const canEdit = canEditStore(store);
    const card = document.createElement("div");
    card.className = "visit-card";
    const itemsRows = (visit.rabbit3d_restock_items || [])
      .map((it) => {
        const model = modelsCache.find((m) => m.id === it.model_id);
        return `<tr><td>${escapeHtml(model?.name || "Modelo borrado")}</td><td>${it.quantity_sold}</td><td>${it.quantity_dropped}</td></tr>`;
      })
      .join("");
    card.innerHTML = `
      <div class="visit-card-header">
        <div>
          <h3>${escapeHtml(store?.name || "Local borrado")}</h3>
          <div class="visit-card-meta">${escapeHtml(formatDateDisplay(visit.visit_date))} · ${escapeHtml(visit.employee_name || "—")}</div>
          ${visit.notes ? `<p class="hint" style="margin-top:6px">${escapeHtml(visit.notes)}</p>` : ""}
        </div>
        <div class="row-actions">
          ${
            canEdit
              ? `<button class="btn btn-edit" data-edit-visit="${visit.id}">Editar</button>
                 <button class="btn btn-danger" data-delete-visit="${visit.id}">Borrar</button>`
              : ""
          }
        </div>
      </div>
      <table class="visit-items-table">
        <thead><tr><th>Modelo</th><th>Vendidos</th><th>Deja ahora</th></tr></thead>
        <tbody>${itemsRows}</tbody>
      </table>
    `;
    list.appendChild(card);
  });
}

document.getElementById("visitsList").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-visit]");
  if (editBtn) {
    const row = visitsCache.find((r) => String(r.id) === editBtn.dataset.editVisit);
    if (row) startEditVisit(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-visit]");
  if (delBtn) {
    if (!confirm("¿Borrar esta reposición completa?")) return;
    await sb.from(TABLE_VISITS).delete().eq("id", delBtn.dataset.deleteVisit);
    loadVisits();
  }
});

// ---------------------------------------------------------------
// ESTADÍSTICAS
// ---------------------------------------------------------------
function renderBarList(container, entries) {
  const max = Math.max(...entries.map((e) => e.value), 1);
  container.innerHTML = "";
  if (!entries.length) {
    container.innerHTML = `<p class="hint">Todavía no hay datos suficientes.</p>`;
    return;
  }
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span class="bar-label">${escapeHtml(entry.name)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(entry.value / max) * 100}%"></div></div>
      <span class="bar-value">${entry.value}</span>
    `;
    container.appendChild(row);
  });
}

function renderStats() {
  const salesByModel = {};
  const salesByStore = {};
  visitsCache.forEach((visit) => {
    const store = storesCache.find((s) => s.id === visit.store_id);
    const storeName = store?.name || "Local borrado";
    (visit.rabbit3d_restock_items || []).forEach((it) => {
      const model = modelsCache.find((m) => m.id === it.model_id);
      const modelName = model?.name || "Modelo borrado";
      salesByModel[modelName] = (salesByModel[modelName] || 0) + Number(it.quantity_sold || 0);
      salesByStore[storeName] = (salesByStore[storeName] || 0) + Number(it.quantity_sold || 0);
    });
  });

  const modelEntries = Object.entries(salesByModel)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const storeEntries = Object.entries(salesByStore)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  renderBarList(document.getElementById("statsModelsList"), modelEntries);
  renderBarList(document.getElementById("statsStoreList"), storeEntries);
}
