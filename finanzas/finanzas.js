import { createSupabaseClient } from "../shared/js/supabase-config.js";
import { escapeHtml } from "../shared/js/dom-utils.js";
import { todayLocalISODate, formatDateDisplay } from "../shared/js/date-utils.js";

const TABLE_EXPENSES = "rabbit3d_expenses";
const TABLE_EXPENSE_CATEGORIES = "rabbit3d_expense_categories";
const TABLE_INCOME_COST_LINES = "rabbit3d_income_cost_lines";
const TABLE_PRICE_CALCS = "rabbit3d_price_calcs";
const TABLE_COST_ITEMS = "rabbit3d_cost_items";
const TABLE_FILAMENT_PRICE = "rabbit3d_filament_price";
const TABLE_PROFIT_SHARE = "rabbit3d_profit_share";

const sb = createSupabaseClient();

function money(n) {
  return `$${Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------
// AUTENTICACIÓN (mismo esquema que admin.html)
// ---------------------------------------------------------------
const loginScreen = document.getElementById("loginScreen");
const panelScreen = document.getElementById("panelScreen");

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("loginStatus");
  status.className = "status busy";
  status.textContent = "Iniciando sesión…";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    status.className = "status err";
    status.textContent = "No se pudo iniciar sesión: " + error.message;
    return;
  }
  status.className = "status ok";
  status.textContent = "¡Listo!";
  await enterPanel();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

async function enterPanel() {
  const { data } = await sb.auth.getUser();
  if (!data?.user) return;
  document.getElementById("userEmail").textContent = data.user.email;
  loginScreen.style.display = "none";
  panelScreen.style.display = "block";

  cancelEditExpense();
  cancelEditCalc();
  loadExpenseCategories();
  loadExpenses();
  loadCostItems();
  loadFilamentPrice();
  loadProfitShare(); // esta ya llama a loadCalcs() al final, con el % correcto
}

sb.auth.getSession().then(({ data }) => {
  if (data?.session) enterPanel();
});

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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tabs .tab[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => switchMainTab(tab.dataset.tab));
});

document.querySelectorAll("#bottomNav [data-nav-tab]").forEach((btn) => {
  btn.addEventListener("click", () => switchMainTab(btn.dataset.navTab));
});

document.getElementById("navLogoutMobile").addEventListener("click", () => {
  document.getElementById("logoutBtn").click();
});

// ---------------------------------------------------------------
// GASTOS Y GANANCIAS (movimientos)
// ---------------------------------------------------------------
// Compatibilidad con gastos viejos, que guardaban la categoría como
// slug fijo (ej. "filamento") en vez del texto libre de ahora.
const CATEGORY_LABELS = {
  filamento: "Filamento",
  insumos: "Insumos",
  mantenimiento: "Mantenimiento",
  electricidad: "Electricidad",
  mano_obra: "Mano de obra",
  otro: "Otro",
};

let editingExpenseId = null;
let expensesCache = [];
let expensesFilter = "todos";
let expenseCategoriesCache = [];
let movementsCategoryFilter = null; // { type, category } o null

function currentExpenseType() {
  return document.querySelector("#exp_type_tabs .tab.is-active").dataset.type;
}

async function loadExpenseCategories() {
  const { data, error } = await sb
    .from(TABLE_EXPENSE_CATEGORIES)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  expenseCategoriesCache = error ? [] : data;
  renderExpenseCategoryOptions();
}

function renderExpenseCategoryOptions(selectName) {
  const select = document.getElementById("exp_category");
  const type = currentExpenseType();
  const keep = selectName || select.value;
  const options = expenseCategoriesCache.filter((c) => (c.type || "gasto") === type);
  select.innerHTML = options.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  if (keep && options.some((c) => c.name === keep)) select.value = keep;
}

document.getElementById("exp_new_category_link").addEventListener("click", (e) => {
  e.preventDefault();
  const row = document.getElementById("exp_new_category_row");
  row.style.display = row.style.display === "none" ? "flex" : "none";
  if (row.style.display === "flex") document.getElementById("exp_new_category_name").focus();
});

document.getElementById("exp_new_category_save").addEventListener("click", async () => {
  const input = document.getElementById("exp_new_category_name");
  const name = input.value.trim();
  if (!name) return;
  const type = currentExpenseType();
  const countForType = expenseCategoriesCache.filter((c) => (c.type || "gasto") === type).length;
  const { error } = await sb.from(TABLE_EXPENSE_CATEGORIES).insert({ name, type, sort_order: countForType });
  if (error) {
    alert("No se pudo agregar la categoría: " + error.message);
    return;
  }
  input.value = "";
  document.getElementById("exp_new_category_row").style.display = "none";
  await loadExpenseCategories();
  renderExpenseCategoryOptions(name);
});

function applyExpenseTypeUI() {
  const isGasto = currentExpenseType() === "gasto";
  renderExpenseCategoryOptions();
  document.getElementById("exp_submit").textContent = editingExpenseId
    ? "Guardar cambios"
    : isGasto
    ? "Guardar gasto"
    : "Guardar ingreso";

  document.getElementById("exp_calc_toggle").style.display = isGasto ? "inline-block" : "none";
  document.getElementById("inc_calc_toggle").style.display = isGasto ? "none" : "inline-block";
  if (isGasto) {
    document.getElementById("inc_calc_wrap").style.display = "none";
  } else {
    document.getElementById("exp_calc_wrap").style.display = "none";
    updateIncomeCalcSummary();
  }
}

document.querySelectorAll("#exp_type_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#exp_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    applyExpenseTypeUI();
  });
});

function cancelEditExpense() {
  editingExpenseId = null;
  document.getElementById("expenseForm").reset();
  document.getElementById("exp_date").value = todayLocalISODate();
  document.querySelectorAll("#exp_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#exp_type_tabs .tab[data-type="gasto"]').classList.add("is-active");
  applyExpenseTypeUI();
  document.getElementById("exp_form_title").textContent = "Nuevo movimiento";
  document.getElementById("exp_cancel_edit").style.display = "none";
  document.getElementById("exp_calc_wrap").style.display = "none";
  document.getElementById("exp_calc_grams").value = "";
  document.getElementById("exp_calc_filament_preview").textContent = "";
  document.getElementById("exp_calc_cost_lines").innerHTML = "";
  renderExpCalcFixedItemsChecklist();

  document.getElementById("inc_calc_wrap").style.display = "none";
  document.getElementById("inc_calc_grams").value = "";
  document.getElementById("inc_calc_filament_preview").textContent = "";
  document.getElementById("inc_calc_cost_lines").innerHTML = "";
  renderIncCalcFixedItemsChecklist();
  updateIncomeCalcSummary();
}
document.getElementById("exp_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditExpense();
});

// ---------------------------------------------------------------
// Calculadora de costos, dentro del formulario de gastos — igual que
// la pestaña "Calculadora de precio" (filamento por gramos + insumos
// fijos + líneas manuales), pero sin precio de venta ni ganancia: acá
// solo interesa el costo total, para completar el "Monto total" solo.
// Útil para regalos/donaciones u otros gastos sin factura, donde lo
// único que sabés es cuánto material/insumos se usaron.
// ---------------------------------------------------------------
let expCalcLineIdCounter = 0;

document.getElementById("exp_calc_toggle").addEventListener("click", (e) => {
  e.preventDefault();
  const wrap = document.getElementById("exp_calc_wrap");
  wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  if (wrap.style.display === "block") renderExpCalcFixedItemsChecklist();
});

function renderExpCalcFixedItemsChecklist() {
  const list = document.getElementById("exp_calc_fixed_items_list");
  if (!list) return;
  list.innerHTML = "";
  if (!costItemsCache.length) {
    list.innerHTML = `<p class="hint">Todavía no cargaste ningún insumo fijo (pestaña "Insumos fijos").</p>`;
    return;
  }
  costItemsCache.forEach((item) => {
    const row = document.createElement("div");
    row.className = "checkbox-row";
    row.innerHTML = `
      <span class="cr-left">
        <input type="checkbox" data-exp-fixed-item-checkbox="${item.id}">
        <span>${escapeHtml(item.name)}</span>
      </span>
      <span class="cr-price">${money(item.amount)}</span>
    `;
    list.appendChild(row);
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        addExpCalcCostLineRow(item.name, item.amount, item.id);
      } else {
        removeExpCalcCostLineByFixedItem(item.id);
      }
    });
  });
}

function removeExpCalcCostLineByFixedItem(fixedItemId) {
  const row = document.querySelector(`#exp_calc_cost_lines .calc-cost-line[data-fixed-item-id="${fixedItemId}"]`);
  if (row) row.remove();
  updateExpCalcTotal();
}

function addExpCalcCostLineRow(label = "", amount = "", fixedItemId = null) {
  const id = ++expCalcLineIdCounter;
  const container = document.getElementById("exp_calc_cost_lines");
  const row = document.createElement("div");
  row.className = "grid-2 calc-cost-line";
  row.dataset.lineId = id;
  if (fixedItemId != null) row.dataset.fixedItemId = fixedItemId;
  row.innerHTML = `
    <div><input type="text" placeholder="Ej: Insumo extra" class="cl-label" value="${escapeHtml(label)}"></div>
    <div style="display:flex; gap:8px; align-items:center">
      <input type="number" min="0" step="1" placeholder="$ total" class="cl-amount" value="${amount}" style="flex:1">
      <button type="button" class="btn btn-danger btn-small" data-remove-exp-line="${id}">×</button>
    </div>`;
  container.appendChild(row);
  row.querySelector(".cl-label").addEventListener("input", updateExpCalcTotal);
  row.querySelector(".cl-amount").addEventListener("input", updateExpCalcTotal);
  updateExpCalcTotal();
}
document.getElementById("exp_calc_add_line").addEventListener("click", () => addExpCalcCostLineRow());

document.getElementById("exp_calc_cost_lines").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-exp-line]");
  if (!btn) return;
  const row = btn.closest(".calc-cost-line");
  const fixedItemId = row.dataset.fixedItemId;
  const isFilamentLine = row.dataset.filamentLine === "true";
  row.remove();
  if (fixedItemId) {
    const box = document.querySelector(`[data-exp-fixed-item-checkbox="${fixedItemId}"]`);
    if (box) box.checked = false;
  }
  if (isFilamentLine) {
    document.getElementById("exp_calc_grams").value = "";
    document.getElementById("exp_calc_filament_preview").textContent = "";
  }
  updateExpCalcTotal();
});

function updateExpCalcFilamentCost() {
  const grams = Number(document.getElementById("exp_calc_grams").value) || 0;
  const preview = document.getElementById("exp_calc_filament_preview");
  const existingRow = document.querySelector('#exp_calc_cost_lines .calc-cost-line[data-filament-line="true"]');

  if (grams > 0 && filamentPricePerKg > 0) {
    const totalCost = (filamentPricePerKg / 1000) * grams;
    preview.textContent = `= ${money(totalCost)} (a ${money(filamentPricePerKg)}/kg)`;
    if (existingRow) {
      existingRow.querySelector(".cl-label").value = "Filamento";
      existingRow.querySelector(".cl-amount").value = totalCost.toFixed(2);
    } else {
      addExpCalcCostLineRow("Filamento", totalCost.toFixed(2));
      const rows = document.querySelectorAll("#exp_calc_cost_lines .calc-cost-line");
      rows[rows.length - 1].dataset.filamentLine = "true";
    }
  } else {
    preview.textContent =
      grams > 0 && !filamentPricePerKg ? 'Configurá el precio del kg en la pestaña "Insumos fijos".' : "";
    if (existingRow) existingRow.remove();
  }
  updateExpCalcTotal();
}
document.getElementById("exp_calc_grams").addEventListener("input", updateExpCalcFilamentCost);

function updateExpCalcTotal() {
  const lines = Array.from(document.querySelectorAll("#exp_calc_cost_lines .calc-cost-line"));
  const total = lines.reduce((sum, row) => sum + (Number(row.querySelector(".cl-amount").value) || 0), 0);
  document.getElementById("exp_calc_total").textContent = money(total);
  document.getElementById("exp_amount").value = Math.round(total);
}

// ---------------------------------------------------------------
// Costos y reparto de UN PEDIDO (para movimientos de tipo Ingreso).
// Mismo mecanismo que la calculadora de gastos (filamento por gramos +
// insumos fijos + líneas manuales), pero acá NO se usa para completar
// el monto del ingreso (ese es lo que cobraste) — es un desglose aparte
// que se guarda junto al ingreso, para saber cuánto costó de verdad
// ese pedido y cómo se reparte la ganancia.
//
// Cada línea tiene un tilde "¿También contar como gasto real?" — por
// defecto NO, porque el material ya se cuenta como gasto cuando se
// compra en bulto (el rollo de filamento, el paquete de cadenitas).
// Se tilda solo para cosas como pagarle a alguien por un trabajo
// puntual de ESE pedido, que no está reflejado en ninguna otra compra.
// ---------------------------------------------------------------
let incCalcLineIdCounter = 0;

document.getElementById("inc_calc_toggle").addEventListener("click", (e) => {
  e.preventDefault();
  const wrap = document.getElementById("inc_calc_wrap");
  wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  if (wrap.style.display === "block") renderIncCalcFixedItemsChecklist();
});

function gastoCategoryOptionsHtml(selected) {
  const options = expenseCategoriesCache.filter((c) => (c.type || "gasto") === "gasto");
  if (!options.length) return `<option value="">— sin categorías —</option>`;
  return options
    .map((c) => `<option value="${escapeHtml(c.name)}" ${c.name === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");
}

function renderIncCalcFixedItemsChecklist() {
  const list = document.getElementById("inc_calc_fixed_items_list");
  if (!list) return;
  list.innerHTML = "";
  if (!costItemsCache.length) {
    list.innerHTML = `<p class="hint">Todavía no cargaste ningún insumo fijo (pestaña "Insumos fijos").</p>`;
    return;
  }
  costItemsCache.forEach((item) => {
    const row = document.createElement("div");
    row.className = "checkbox-row";
    row.innerHTML = `
      <span class="cr-left">
        <input type="checkbox" data-inc-fixed-item-checkbox="${item.id}">
        <span>${escapeHtml(item.name)}</span>
      </span>
      <span class="cr-price">${money(item.amount)}</span>
    `;
    list.appendChild(row);
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        addIncCalcCostLineRow({ label: item.name, amount: item.amount, fixedItemId: item.id });
      } else {
        removeIncCalcCostLineByFixedItem(item.id);
      }
    });
  });
}

function removeIncCalcCostLineByFixedItem(fixedItemId) {
  const row = document.querySelector(`#inc_calc_cost_lines .calc-cost-line[data-fixed-item-id="${fixedItemId}"]`);
  if (row) row.remove();
  updateIncomeCalcSummary();
}

function addIncCalcCostLineRow({ label = "", amount = "", fixedItemId = null, countsAsGasto = false, gastoCategory = "" } = {}) {
  const id = ++incCalcLineIdCounter;
  const container = document.getElementById("inc_calc_cost_lines");
  const row = document.createElement("div");
  row.className = "calc-cost-line";
  row.dataset.lineId = id;
  if (fixedItemId != null) row.dataset.fixedItemId = fixedItemId;
  row.innerHTML = `
    <div class="grid-2">
      <div><input type="text" placeholder="Ej: Cadenitas" class="cl-label" value="${escapeHtml(label)}"></div>
      <div style="display:flex; gap:8px; align-items:center">
        <input type="number" min="0" step="1" placeholder="$ total" class="cl-amount" value="${amount}" style="flex:1">
        <button type="button" class="btn btn-danger btn-small" data-remove-inc-line="${id}">×</button>
      </div>
    </div>
    <label class="checkbox-row" style="margin-top:6px">
      <span class="cr-left">
        <input type="checkbox" class="cl-counts-gasto" ${countsAsGasto ? "checked" : ""}>
        <span>También contar como gasto real</span>
      </span>
    </label>
    <div class="cl-gasto-category-row" style="display:${countsAsGasto ? "block" : "none"}; margin:6px 0 10px">
      <select class="cl-gasto-category">${gastoCategoryOptionsHtml(gastoCategory)}</select>
    </div>
  `;
  container.appendChild(row);
  row.querySelector(".cl-label").addEventListener("input", updateIncomeCalcSummary);
  row.querySelector(".cl-amount").addEventListener("input", updateIncomeCalcSummary);
  row.querySelector(".cl-counts-gasto").addEventListener("change", (e) => {
    row.querySelector(".cl-gasto-category-row").style.display = e.target.checked ? "block" : "none";
    if (e.target.checked) row.querySelector(".cl-gasto-category").innerHTML = gastoCategoryOptionsHtml();
  });
  updateIncomeCalcSummary();
}
document.getElementById("inc_calc_add_line").addEventListener("click", () => addIncCalcCostLineRow());

document.getElementById("inc_calc_cost_lines").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-inc-line]");
  if (!btn) return;
  const row = btn.closest(".calc-cost-line");
  const fixedItemId = row.dataset.fixedItemId;
  const isFilamentLine = row.dataset.filamentLine === "true";
  row.remove();
  if (fixedItemId) {
    const box = document.querySelector(`[data-inc-fixed-item-checkbox="${fixedItemId}"]`);
    if (box) box.checked = false;
  }
  if (isFilamentLine) {
    document.getElementById("inc_calc_grams").value = "";
    document.getElementById("inc_calc_filament_preview").textContent = "";
  }
  updateIncomeCalcSummary();
});

function updateIncomeCalcFilamentCost() {
  const grams = Number(document.getElementById("inc_calc_grams").value) || 0;
  const preview = document.getElementById("inc_calc_filament_preview");
  const existingRow = document.querySelector('#inc_calc_cost_lines .calc-cost-line[data-filament-line="true"]');

  if (grams > 0 && filamentPricePerKg > 0) {
    const totalCost = (filamentPricePerKg / 1000) * grams;
    preview.textContent = `= ${money(totalCost)} (a ${money(filamentPricePerKg)}/kg)`;
    if (existingRow) {
      existingRow.querySelector(".cl-label").value = "Filamento";
      existingRow.querySelector(".cl-amount").value = totalCost.toFixed(2);
    } else {
      addIncCalcCostLineRow({ label: "Filamento", amount: totalCost.toFixed(2) });
      const rows = document.querySelectorAll("#inc_calc_cost_lines .calc-cost-line");
      rows[rows.length - 1].dataset.filamentLine = "true";
    }
  } else {
    preview.textContent =
      grams > 0 && !filamentPricePerKg ? 'Configurá el precio del kg en la pestaña "Insumos fijos".' : "";
    if (existingRow) existingRow.remove();
  }
  updateIncomeCalcSummary();
}
document.getElementById("inc_calc_grams").addEventListener("input", updateIncomeCalcFilamentCost);

// Lee el estado actual de todas las líneas cargadas (usado tanto para
// mostrar el resumen en vivo como para guardar en la base de datos).
function currentIncomeCostLines() {
  return Array.from(document.querySelectorAll("#inc_calc_cost_lines .calc-cost-line")).map((row) => ({
    label: row.querySelector(".cl-label").value.trim() || "Costo",
    amount: Number(row.querySelector(".cl-amount").value) || 0,
    countsAsGasto: row.querySelector(".cl-counts-gasto").checked,
    gastoCategory: row.querySelector(".cl-gasto-category")?.value || "",
  }));
}

function updateIncomeCalcSummary() {
  const income = Number(document.getElementById("exp_amount").value) || 0;
  const lines = currentIncomeCostLines();
  const totalCosts = lines.reduce((sum, l) => sum + l.amount, 0);
  const net = income - totalCosts;
  const myPct = myProfitSharePercent || 0;
  const myShare = net * (myPct / 100);
  const bizShare = net - myShare;

  document.getElementById("inc_calc_income").textContent = money(income);
  document.getElementById("inc_calc_costs").textContent = money(totalCosts);
  document.getElementById("inc_calc_net").textContent = money(net);
  document.getElementById("inc_calc_biz_share").textContent = `${money(bizShare)} (${100 - myPct}%)`;
  document.getElementById("inc_calc_my_share").textContent = `${money(myShare)} (${myPct}%)`;
}
document.getElementById("exp_amount").addEventListener("input", updateIncomeCalcSummary);

// En celular, el formulario vive en una ficha que sube desde abajo. En
// escritorio estas mismas funciones no hacen nada visible (la ficha ya
// está siempre en su lugar en la página).
function openMoveSheet() {
  document.getElementById("moveFormWrap").classList.add("is-open");
  document.getElementById("moveFormBackdrop").classList.add("is-open");
}
function closeMoveSheet() {
  document.getElementById("moveFormWrap").classList.remove("is-open");
  document.getElementById("moveFormBackdrop").classList.remove("is-open");
}
document.getElementById("fabAdd").addEventListener("click", () => {
  cancelEditExpense();
  openMoveSheet();
});
document.getElementById("moveFormCloseMobile").addEventListener("click", closeMoveSheet);
document.getElementById("moveFormBackdrop").addEventListener("click", closeMoveSheet);

async function startEditExpense(row) {
  editingExpenseId = row.id;
  document.getElementById("exp_date").value = row.expense_date;
  document.querySelectorAll("#exp_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector(`#exp_type_tabs .tab[data-type="${row.type || "gasto"}"]`).classList.add("is-active");
  applyExpenseTypeUI();
  if (row.category) document.getElementById("exp_category").value = row.category;
  document.getElementById("exp_description").value = row.description || "";
  document.getElementById("exp_amount").value = row.amount;
  document.getElementById("exp_notes").value = row.notes || "";
  document.getElementById("exp_form_title").textContent = "Editando movimiento";
  document.getElementById("exp_cancel_edit").style.display = "inline-block";
  document.getElementById("exp_submit").textContent = "Guardar cambios";

  // Recargar el desglose de costos guardado, si es un ingreso.
  document.getElementById("inc_calc_cost_lines").innerHTML = "";
  document.getElementById("inc_calc_grams").value = "";
  document.getElementById("inc_calc_filament_preview").textContent = "";
  renderIncCalcFixedItemsChecklist();

  if ((row.type || "gasto") === "ingreso") {
    const { data: lines } = await sb
      .from(TABLE_INCOME_COST_LINES)
      .select("*")
      .eq("income_id", row.id)
      .order("sort_order", { ascending: true });

    if (lines && lines.length) {
      document.getElementById("inc_calc_wrap").style.display = "block";

      const linkedIds = lines.map((l) => l.linked_expense_id).filter(Boolean);
      let linkedGastoCategories = {};
      if (linkedIds.length) {
        const { data: linkedRows } = await sb.from(TABLE_EXPENSES).select("id, category").in("id", linkedIds);
        (linkedRows || []).forEach((r) => (linkedGastoCategories[r.id] = r.category));
      }

      lines.forEach((l) => {
        addIncCalcCostLineRow({
          label: l.label,
          amount: l.amount,
          countsAsGasto: l.counts_as_gasto,
          gastoCategory: l.linked_expense_id ? linkedGastoCategories[l.linked_expense_id] : "",
        });
        if (l.label === "Filamento") {
          const rows = document.querySelectorAll("#inc_calc_cost_lines .calc-cost-line");
          rows[rows.length - 1].dataset.filamentLine = "true";
          if (filamentPricePerKg > 0) {
            const grams = Math.round((l.amount / filamentPricePerKg) * 1000);
            document.getElementById("inc_calc_grams").value = grams;
            document.getElementById("inc_calc_filament_preview").textContent =
              `= ${money(l.amount)} (a ${money(filamentPricePerKg)}/kg)`;
          }
        }
      });
      updateIncomeCalcSummary();
    }
  }

  openMoveSheet();
  document.getElementById("panel-gastos").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("exp_status");
  const submitBtn = document.getElementById("exp_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const type = currentExpenseType();
    const expenseDate = document.getElementById("exp_date").value;
    const description = document.getElementById("exp_description").value.trim() || null;
    const payload = {
      expense_date: expenseDate,
      type,
      category: document.getElementById("exp_category").value || null,
      description,
      amount: Number(document.getElementById("exp_amount").value),
      notes: document.getElementById("exp_notes").value.trim() || null,
    };

    let incomeId = editingExpenseId;
    if (editingExpenseId) {
      const { error } = await sb.from(TABLE_EXPENSES).update(payload).eq("id", editingExpenseId);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from(TABLE_EXPENSES).insert(payload).select("id").single();
      if (error) throw error;
      incomeId = data.id;
    }

    // Costos y reparto del pedido (solo para ingresos). Al editar, se
    // borran las líneas anteriores (y sus gastos vinculados) y se
    // vuelven a crear con lo que hay ahora en el formulario — más simple
    // y confiable que tratar de "adivinar" qué cambió línea por línea.
    if (type === "ingreso") {
      const { data: oldLines } = await sb
        .from(TABLE_INCOME_COST_LINES)
        .select("linked_expense_id")
        .eq("income_id", incomeId);
      const oldLinkedIds = (oldLines || []).map((l) => l.linked_expense_id).filter(Boolean);
      if (oldLinkedIds.length) await sb.from(TABLE_EXPENSES).delete().in("id", oldLinkedIds);
      await sb.from(TABLE_INCOME_COST_LINES).delete().eq("income_id", incomeId);

      const lines = currentIncomeCostLines().filter((l) => l.amount > 0 || l.label !== "Costo");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let linkedExpenseId = null;

        if (line.countsAsGasto && line.gastoCategory) {
          const { data: linkedExpense, error: linkedErr } = await sb
            .from(TABLE_EXPENSES)
            .insert({
              expense_date: expenseDate,
              type: "gasto",
              category: line.gastoCategory,
              description: description ? `${description} — ${line.label}` : line.label,
              amount: line.amount,
              notes: null,
            })
            .select("id")
            .single();
          if (linkedErr) throw linkedErr;
          linkedExpenseId = linkedExpense.id;
        }

        const { error: lineErr } = await sb.from(TABLE_INCOME_COST_LINES).insert({
          income_id: incomeId,
          label: line.label,
          amount: line.amount,
          counts_as_gasto: line.countsAsGasto,
          linked_expense_id: linkedExpenseId,
          sort_order: i,
        });
        if (lineErr) throw lineErr;
      }
    }

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditExpense();
    setTimeout(closeMoveSheet, 400); // en celular, cierra la ficha solo tras guardar
    loadExpenses();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.querySelectorAll("#exp_filter_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#exp_filter_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    expensesFilter = tab.dataset.filter;
    renderMovements();
  });
});

function getFilteredMovements() {
  let rows = expensesFilter === "todos" ? expensesCache : expensesCache.filter((r) => (r.type || "gasto") === expensesFilter);
  if (movementsCategoryFilter) {
    if (movementsCategoryFilter.id != null) {
      rows = rows.filter((r) => r.id === movementsCategoryFilter.id);
    } else {
      rows = rows.filter(
        (r) => (r.type || "gasto") === movementsCategoryFilter.type && (r.category || "Sin categoría") === movementsCategoryFilter.category
      );
    }
  }
  return rows;
}

// Un solo lugar decide qué está filtrado; de ahí se pintan las DOS
// versiones (tabla de escritorio y tarjetas de celular) con los mismos datos.
function renderMovements() {
  const chipWrap = document.getElementById("exp_filter_chip");
  if (movementsCategoryFilter) {
    chipWrap.innerHTML = `
      <span class="filter-chip">
        Filtrando por: <strong>${escapeHtml(movementsCategoryFilter.category)}</strong>
        <button type="button" id="exp_clear_category_filter">× quitar</button>
      </span>`;
    document.getElementById("exp_clear_category_filter").addEventListener("click", () => {
      movementsCategoryFilter = null;
      renderMovements();
    });
  } else {
    chipWrap.innerHTML = "";
  }

  const rows = getFilteredMovements();
  renderExpensesTable(rows);
  renderMoveCards(rows);
}

function renderExpensesTable(rows) {
  const tbody = document.getElementById("expensesTableBody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5">Todavía no hay movimientos acá.</td></tr>`;
    return;
  }
  rows.forEach((exp) => {
    const isIncome = exp.type === "ingreso";
    const tipoLabel = isIncome ? "Ingreso" : "Gasto";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(formatDateDisplay(exp.expense_date))}</td>
      <td><span class="summary-value ${isIncome ? "positive" : "negative"}" style="font-size:.8rem">${tipoLabel}</span></td>
      <td>${escapeHtml(exp.description || "—")}${exp.category ? ` <span class="hint" style="display:inline">(${escapeHtml(CATEGORY_LABELS[exp.category] || exp.category)})</span>` : ""}</td>
      <td class="${isIncome ? "positive" : "negative"}">${isIncome ? "+" : "-"}${money(exp.amount)}</td>
      <td class="row-actions">
        ${isIncome ? `<button class="btn btn-ghost btn-small" data-detail-expense="${exp.id}">Ver detalle</button>` : ""}
        <button class="btn btn-edit" data-edit-expense="${exp.id}">Editar</button>
        <button class="btn btn-danger" data-delete-expense="${exp.id}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
    if (isIncome) {
      const detailRow = document.createElement("tr");
      detailRow.className = "income-detail-row";
      detailRow.id = `income-detail-${exp.id}`;
      detailRow.style.display = "none";
      detailRow.innerHTML = `<td colspan="5"></td>`;
      tbody.appendChild(detailRow);
    }
  });
}

// Muestra/oculta el desglose de costos y reparto de un ingreso, sin
// tener que abrir "Editar" — se busca en la base solo la primera vez
// que se despliega cada uno.
const incomeDetailCache = {};
async function toggleIncomeDetail(incomeId, incomeAmount) {
  if (!incomeDetailCache[incomeId]) {
    const { data: lines } = await sb
      .from(TABLE_INCOME_COST_LINES)
      .select("*")
      .eq("income_id", incomeId)
      .order("sort_order", { ascending: true });
    incomeDetailCache[incomeId] = lines || [];
  }
  const lines = incomeDetailCache[incomeId];
  const totalCosts = lines.reduce((s, l) => s + Number(l.amount), 0);
  const net = incomeAmount - totalCosts;
  const myPct = myProfitSharePercent || 0;
  const myShare = net * (myPct / 100);
  const bizShare = net - myShare;

  const bodyHtml = `
    <div style="padding:12px 4px">
      ${
        lines.length
          ? lines
              .map(
                (l) => `
        <div class="summary-item">
          <span class="summary-label">${escapeHtml(l.label)}${l.counts_as_gasto ? ' <span class="hint" style="display:inline">(también en Gastos)</span>' : ""}</span>
          <span class="summary-value">-${money(l.amount)}</span>
        </div>`
              )
              .join("")
          : `<p class="hint" style="margin:0">Este ingreso no tiene costos cargados.</p>`
      }
      <div class="summary-item" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--line)">
        <span class="summary-label">Ganancia neta</span><span class="summary-value">${money(net)}</span>
      </div>
      <div class="summary-item"><span class="summary-label">Para el emprendimiento (${100 - myPct}%)</span><span class="summary-value">${money(bizShare)}</span></div>
      <div class="summary-item"><span class="summary-label">Para vos (${myPct}%)</span><span class="summary-value">${money(myShare)}</span></div>
    </div>
  `;

  // versión escritorio (fila de tabla)
  const tableRow = document.getElementById(`income-detail-${incomeId}`);
  if (tableRow) {
    const nowHidden = tableRow.style.display === "none";
    tableRow.style.display = nowHidden ? "table-row" : "none";
    if (nowHidden) tableRow.querySelector("td").innerHTML = bodyHtml;
  }
  // versión celular (tarjeta)
  const cardDetail = document.getElementById(`income-detail-card-${incomeId}`);
  if (cardDetail) {
    const nowHidden = cardDetail.style.display === "none";
    cardDetail.style.display = nowHidden ? "block" : "none";
    if (nowHidden) cardDetail.innerHTML = bodyHtml;
  }
}

// Versión en tarjetas de la misma lista, para celular (ver estilos con
// media query — en escritorio esta lista existe pero queda oculta).
function renderMoveCards(rows) {
  const list = document.getElementById("moveList");
  list.innerHTML = "";
  if (!rows.length) {
    list.innerHTML = `<p class="hint">Todavía no hay movimientos acá.</p>`;
    return;
  }
  rows.forEach((exp) => {
    const isIncome = exp.type === "ingreso";
    const card = document.createElement("div");
    card.className = "move-card";
    card.innerHTML = `
      <span class="move-icon ${isIncome ? "income" : "expense"}">${isIncome ? "💚" : "📉"}</span>
      <div class="move-info">
        <div class="move-desc">${escapeHtml(exp.description || exp.category || (isIncome ? "Ingreso" : "Gasto"))}</div>
        <div class="move-meta">${escapeHtml(exp.category || "Sin categoría")} · ${escapeHtml(formatDateDisplay(exp.expense_date))}</div>
      </div>
      <div class="move-amount" style="color:${isIncome ? "var(--green)" : "var(--red)"}">${isIncome ? "+" : "-"}${money(exp.amount)}</div>
      <div class="move-actions">
        ${isIncome ? `<button data-detail-expense="${exp.id}" aria-label="Ver detalle">🧾</button>` : ""}
        <button data-edit-expense="${exp.id}" aria-label="Editar">✏️</button>
        <button data-delete-expense="${exp.id}" aria-label="Borrar">🗑️</button>
      </div>`;
    list.appendChild(card);
    if (isIncome) {
      const detail = document.createElement("div");
      detail.className = "income-detail-card";
      detail.id = `income-detail-card-${exp.id}`;
      detail.style.display = "none";
      list.appendChild(detail);
    }
  });
}

const CATEGORY_COLORS = ["#818CF8", "#F59E0B", "#22D3EE", "#A78BFA", "#FACC15", "#38BDF8", "#FB923C", "#C084FC", "#94A1B4", "#2DD4BF"];
let expensesPeriod = "mes";
let categoryChartType = "gasto";

document.querySelectorAll("#exp_period_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#exp_period_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    expensesPeriod = tab.dataset.period;
    renderExpenseStats();
  });
});

document.querySelectorAll("#cat_type_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#cat_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    categoryChartType = tab.dataset.cattype;
    renderExpenseStats();
  });
});

function rowInPeriod(row) {
  if (expensesPeriod === "todo") return true;
  if (!row.expense_date) return false;
  const todayStr = todayLocalISODate(); // ya en hora local, ver todayLocalISODate()
  if (expensesPeriod === "mes") return row.expense_date.slice(0, 7) === todayStr.slice(0, 7);
  if (expensesPeriod === "anio") return row.expense_date.slice(0, 4) === todayStr.slice(0, 4);
  return true;
}

function renderPie(pieEl, legendEl, breakdown, onClickItem) {
  const total = breakdown.reduce((s, b) => s + b.amount, 0);
  if (!breakdown.length || !total) {
    pieEl.style.background = "var(--bg-panel-alt)";
    legendEl.innerHTML = `<p class="hint">Sin movimientos en este período.</p>`;
    return;
  }
  let cursor = 0;
  const stops = breakdown
    .map((b) => {
      const pct = (b.amount / total) * 100;
      const start = cursor;
      cursor += pct;
      return `${b.color} ${start}% ${cursor}%`;
    })
    .join(", ");
  pieEl.style.background = `conic-gradient(${stops})`;

  legendEl.innerHTML = "";
  breakdown.forEach((b) => {
    const row = document.createElement("div");
    row.className = "legend-row" + (onClickItem ? " is-clickable" : "");
    row.innerHTML = `
      <span class="legend-swatch" style="background:${b.color}"></span>
      <span class="legend-name">${escapeHtml(b.name)}</span>
      <span class="legend-amount">${money(b.amount)}</span>
      <span class="legend-pct">${((b.amount / total) * 100).toFixed(0)}%</span>
    `;
    if (onClickItem) row.addEventListener("click", () => onClickItem(b));
    legendEl.appendChild(row);
  });
}

function renderExpenseStats() {
  const rowsInPeriod = expensesCache.filter(rowInPeriod);
  let income = 0, expense = 0;
  rowsInPeriod.forEach((r) => {
    if (r.type === "ingreso") income += Number(r.amount);
    else expense += Number(r.amount);
  });
  const balance = income - expense;

  document.getElementById("stat_income").textContent = money(income);
  document.getElementById("stat_expense").textContent = money(expense);
  const balanceEl = document.getElementById("stat_balance");
  balanceEl.textContent = money(balance);
  balanceEl.className = `stat-value ${balance >= 0 ? "positive" : "negative"}`;

  // Torta: Ingresos vs Gastos — tocar una porción filtra los Movimientos por ese tipo.
  renderPie(
    document.getElementById("io_pie"),
    document.getElementById("io_legend"),
    [
      { name: "Ingresos", amount: income, color: "#4ADE80" },
      { name: "Gastos", amount: expense, color: "#E8125C" },
    ],
    (item) => {
      const type = item.name === "Ingresos" ? "ingreso" : "gasto";
      document.querySelectorAll("#exp_filter_tabs .tab").forEach((t) => t.classList.remove("is-active"));
      document.querySelector(`#exp_filter_tabs .tab[data-filter="${type}"]`).classList.add("is-active");
      expensesFilter = type;
      movementsCategoryFilter = null;
      renderMovements();
      document.getElementById("panel-gastos").querySelector(".finance-col:last-child").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  );

  // Torta "Por categoría": los gastos se agrupan por categoría; los
  // ingresos se muestran uno por uno (usando su descripción), ya que
  // agruparlos por categoría los mezclaba todos en una sola porción.
  let breakdown;
  if (categoryChartType === "ingreso") {
    breakdown = rowsInPeriod
      .filter((r) => r.type === "ingreso")
      .map((r, i) => ({
        id: r.id,
        name: r.description || r.category || "Ingreso",
        amount: Number(r.amount),
        color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  } else {
    const totals = {};
    rowsInPeriod
      .filter((r) => (r.type || "gasto") === "gasto")
      .forEach((r) => {
        const key = r.category || "Sin categoría";
        totals[key] = (totals[key] || 0) + Number(r.amount);
      });
    breakdown = Object.entries(totals)
      .map(([name, amount], i) => ({ name, amount, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))
      .sort((a, b) => b.amount - a.amount);
  }

  renderPie(document.getElementById("cat_pie"), document.getElementById("cat_legend"), breakdown, (item) => {
    document.querySelectorAll("#exp_filter_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelector(`#exp_filter_tabs .tab[data-filter="${categoryChartType}"]`).classList.add("is-active");
    expensesFilter = categoryChartType;
    movementsCategoryFilter =
      categoryChartType === "ingreso"
        ? { type: "ingreso", id: item.id, category: item.name }
        : { type: categoryChartType, category: item.name };
    renderMovements();
    document.getElementById("panel-gastos").querySelector(".finance-col:last-child").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function loadExpenses() {
  const { data, error } = await sb
    .from(TABLE_EXPENSES)
    .select("*")
    .order("expense_date", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    document.getElementById("expensesTableBody").innerHTML = `<tr><td colspan="5">Error cargando: ${error.message}</td></tr>`;
    document.getElementById("moveList").innerHTML = `<p class="hint">Error cargando: ${error.message}</p>`;
    return;
  }
  expensesCache = data;
  renderMovements();
  renderExpenseStats();
}

async function handleMovementListClick(e) {
  const editBtn = e.target.closest("[data-edit-expense]");
  if (editBtn) {
    const row = expensesCache.find((r) => String(r.id) === editBtn.dataset.editExpense);
    if (row) startEditExpense(row);
    return;
  }
  const detailBtn = e.target.closest("[data-detail-expense]");
  if (detailBtn) {
    const row = expensesCache.find((r) => String(r.id) === detailBtn.dataset.detailExpense);
    if (row) toggleIncomeDetail(row.id, Number(row.amount));
    return;
  }
  const delBtn = e.target.closest("[data-delete-expense]");
  if (delBtn) {
    if (!confirm("¿Borrar este movimiento?")) return;
    await sb.from(TABLE_EXPENSES).delete().eq("id", delBtn.dataset.deleteExpense);
    loadExpenses();
  }
}
document.getElementById("expensesTableBody").addEventListener("click", handleMovementListClick);
document.getElementById("moveList").addEventListener("click", handleMovementListClick);

// ---------------------------------------------------------------
// INSUMOS FIJOS (monto fijo por pedido, no se escala con la cantidad)
// ---------------------------------------------------------------
let editingCostItemId = null;
let costItemsCache = [];

function cancelEditCostItem() {
  editingCostItemId = null;
  document.getElementById("costItemForm").reset();
  document.getElementById("ci_form_title").textContent = "Nuevo insumo fijo";
  document.getElementById("ci_cancel_edit").style.display = "none";
  document.getElementById("ci_submit").textContent = "Guardar insumo";
}
document.getElementById("ci_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditCostItem();
});

function startEditCostItem(row) {
  editingCostItemId = row.id;
  document.getElementById("ci_name").value = row.name;
  document.getElementById("ci_amount").value = row.amount;
  document.getElementById("ci_form_title").textContent = "Editando insumo";
  document.getElementById("ci_cancel_edit").style.display = "inline-block";
  document.getElementById("ci_submit").textContent = "Guardar cambios";
  document.getElementById("panel-insumos").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("costItemForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("ci_status");
  const submitBtn = document.getElementById("ci_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const payload = {
      name: document.getElementById("ci_name").value.trim(),
      amount: Number(document.getElementById("ci_amount").value),
    };

    const { error } = editingCostItemId
      ? await sb.from(TABLE_COST_ITEMS).update(payload).eq("id", editingCostItemId)
      : await sb.from(TABLE_COST_ITEMS).insert(payload);
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditCostItem();
    loadCostItems();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadCostItems() {
  const { data, error } = await sb.from(TABLE_COST_ITEMS).select("*").order("sort_order", { ascending: true }).order("id", { ascending: true });
  const tbody = document.getElementById("costItemsTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`;
    costItemsCache = [];
    renderFixedItemsChecklist();
    return;
  }
  costItemsCache = data;

  data.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${money(item.amount)}</td>
      <td class="row-actions">
        <button class="btn btn-edit" data-edit-costitem="${item.id}">Editar</button>
        <button class="btn btn-danger" data-delete-costitem="${item.id}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });

  renderFixedItemsChecklist();
}

document.getElementById("costItemsTableBody").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-costitem]");
  if (editBtn) {
    const row = costItemsCache.find((r) => String(r.id) === editBtn.dataset.editCostitem);
    if (row) startEditCostItem(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-costitem]");
  if (delBtn) {
    if (!confirm("¿Borrar este insumo fijo?")) return;
    await sb.from(TABLE_COST_ITEMS).delete().eq("id", delBtn.dataset.deleteCostitem);
    loadCostItems();
  }
});

// Checklist dentro de la Calculadora: tildar agrega una línea de costo
// (el monto tal cual, sin dividir ni multiplicar), destildar la saca.
function renderFixedItemsChecklist() {
  const list = document.getElementById("calc_fixed_items_list");
  if (!list) return;
  list.innerHTML = "";
  if (!costItemsCache.length) {
    list.innerHTML = `<p class="hint">Todavía no cargaste ningún insumo fijo (pestaña "Insumos fijos").</p>`;
    return;
  }
  costItemsCache.forEach((item) => {
    const row = document.createElement("div");
    row.className = "checkbox-row";
    row.innerHTML = `
      <span class="cr-left">
        <input type="checkbox" data-fixed-item-checkbox="${item.id}">
        <span>${escapeHtml(item.name)}</span>
      </span>
      <span class="cr-price">${money(item.amount)}</span>
    `;
    list.appendChild(row);
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) {
        addCalcCostLineRow(item.name, item.amount, item.id);
      } else {
        removeCalcCostLineByFixedItem(item.id);
      }
    });
  });
}

function syncFixedItemCheckbox(fixedItemId, checked) {
  const box = document.querySelector(`[data-fixed-item-checkbox="${fixedItemId}"]`);
  if (box) box.checked = checked;
}

function removeCalcCostLineByFixedItem(fixedItemId) {
  const row = document.querySelector(`#calc_cost_lines .calc-cost-line[data-fixed-item-id="${fixedItemId}"]`);
  if (row) row.remove();
  updateCalcSummary();
}

// ---------------------------------------------------------------
// PRECIO DEL FILAMENTO (por kg)
// ---------------------------------------------------------------
let filamentPricePerKg = 0;

async function loadFilamentPrice() {
  const { data, error } = await sb.from(TABLE_FILAMENT_PRICE).select("*").eq("id", 1).maybeSingle();
  filamentPricePerKg = error || !data ? 0 : Number(data.price_per_kg) || 0;
  document.getElementById("fp_price").value = filamentPricePerKg || "";
  updateCalcFilamentCost();
}

document.getElementById("filamentPriceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("fp_status");
  const submitBtn = document.getElementById("fp_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";
    const price = Number(document.getElementById("fp_price").value) || 0;
    const { error } = await sb
      .from(TABLE_FILAMENT_PRICE)
      .upsert({ id: 1, price_per_kg: price, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
    filamentPricePerKg = price;
    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    updateCalcFilamentCost();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------
// REPARTO DE GANANCIA (emprendimiento vs. sueldo tuyo)
// ---------------------------------------------------------------
let myProfitSharePercent = 0;

async function loadProfitShare() {
  const { data, error } = await sb.from(TABLE_PROFIT_SHARE).select("*").eq("id", 1).maybeSingle();
  myProfitSharePercent = error || !data ? 0 : Number(data.my_share_percent) || 0;
  document.getElementById("ps_percent").value = myProfitSharePercent || "";
  updateCalcSummary();
  loadCalcs();
}

document.getElementById("profitShareForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("ps_status");
  const submitBtn = document.getElementById("ps_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";
    const pct = Number(document.getElementById("ps_percent").value) || 0;
    const { error } = await sb
      .from(TABLE_PROFIT_SHARE)
      .upsert({ id: 1, my_share_percent: pct, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
    myProfitSharePercent = pct;
    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    updateCalcSummary();
    loadCalcs();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// En la Calculadora: los gramos ingresados generan/actualizan sola una
// línea de costo "Filamento", igual de automática que los insumos fijos.
// Los gramos que se cargan son para TODO EL LOTE (ej: lo que gasta la
// plancha completa con las 50 piezas) — la línea guarda el total del
// lote, igual que todas las demás; la división a "por unidad" se hace
// en un solo lugar (el resumen), no acá.
function updateCalcFilamentCost() {
  const grams = Number(document.getElementById("calc_filament_grams").value) || 0;
  const batch = Number(document.getElementById("calc_batch").value) || 1;
  const preview = document.getElementById("calc_filament_preview");
  const existingRow = document.querySelector('#calc_cost_lines .calc-cost-line[data-filament-line="true"]');

  if (grams > 0 && filamentPricePerKg > 0) {
    const totalCost = (filamentPricePerKg / 1000) * grams;
    preview.textContent = `= ${money(totalCost)} el lote → ${money(totalCost / batch)} por unidad (a ${money(filamentPricePerKg)}/kg, ${batch} un.)`;
    if (existingRow) {
      existingRow.querySelector(".cl-label").value = "Filamento";
      existingRow.querySelector(".cl-amount").value = totalCost.toFixed(2);
    } else {
      addCalcCostLineRow("Filamento", totalCost.toFixed(2));
      const rows = document.querySelectorAll("#calc_cost_lines .calc-cost-line");
      rows[rows.length - 1].dataset.filamentLine = "true";
    }
  } else {
    preview.textContent =
      grams > 0 && !filamentPricePerKg ? 'Configurá el precio del kg en la pestaña "Insumos fijos".' : "";
    if (existingRow) existingRow.remove();
  }
  updateCalcSummary();
}
document.getElementById("calc_filament_grams").addEventListener("input", updateCalcFilamentCost);

// Reacciona a cambios en la cantidad del lote: el filamento depende de
// la cantidad para mostrar el "por unidad" en la vista previa; los
// insumos fijos ya no dependen del lote (son un monto fijo).
function onCalcBatchChange() {
  updateCalcFilamentCost(); // ya llama a updateCalcSummary() al final
}
document.getElementById("calc_batch").addEventListener("input", onCalcBatchChange);

// ---------------------------------------------------------------
// CALCULADORA DE PRECIO
// ---------------------------------------------------------------
let editingCalcId = null;
let calcLineIdCounter = 0;

function addCalcCostLineRow(label = "", amount = "", fixedItemId = null) {
  const id = ++calcLineIdCounter;
  const container = document.getElementById("calc_cost_lines");
  const row = document.createElement("div");
  row.className = "grid-2 calc-cost-line";
  row.dataset.lineId = id;
  if (fixedItemId != null) row.dataset.fixedItemId = fixedItemId;
  row.innerHTML = `
    <div><input type="text" placeholder="Ej: Filamento" class="cl-label" value="${escapeHtml(label)}"></div>
    <div style="display:flex; gap:8px; align-items:center">
      <input type="number" min="0" step="1" placeholder="$ total del lote" class="cl-amount" value="${amount}" style="flex:1">
      <button type="button" class="btn btn-danger btn-small" data-remove-line="${id}">×</button>
    </div>`;
  container.appendChild(row);
  row.querySelector(".cl-label").addEventListener("input", updateCalcSummary);
  row.querySelector(".cl-amount").addEventListener("input", updateCalcSummary);
  updateCalcSummary();
}
document.getElementById("calc_add_line").addEventListener("click", () => addCalcCostLineRow());

document.getElementById("calc_cost_lines").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-line]");
  if (!btn) return;
  const row = btn.closest(".calc-cost-line");
  const fixedItemId = row.dataset.fixedItemId;
  const isFilamentLine = row.dataset.filamentLine === "true";
  row.remove();
  if (fixedItemId) syncFixedItemCheckbox(fixedItemId, false);
  if (isFilamentLine) {
    document.getElementById("calc_filament_grams").value = "";
    document.getElementById("calc_filament_preview").textContent = "";
  }
  updateCalcSummary();
});

document.querySelectorAll("#calc_price_mode_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#calc_price_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    document.getElementById("calc_price_label").textContent =
      tab.dataset.mode === "unit" ? "Precio de venta por unidad" : "Precio de venta total del lote";
    updateCalcSummary();
  });
});
document.getElementById("calc_price").addEventListener("input", updateCalcSummary);

function currentCalcCostLines() {
  return Array.from(document.querySelectorAll("#calc_cost_lines .calc-cost-line")).map((row) => {
    const line = {
      label: row.querySelector(".cl-label").value.trim() || "Sin nombre",
      amount_total: Number(row.querySelector(".cl-amount").value) || 0,
    };
    if (row.dataset.filamentLine === "true") {
      line.grams = Number(document.getElementById("calc_filament_grams").value) || 0;
    }
    return line;
  });
}

function currentCalcPriceMode() {
  return document.querySelector("#calc_price_mode_tabs .tab.is-active").dataset.mode;
}

function updateCalcSummary() {
  const lines = currentCalcCostLines();
  const batch = Number(document.getElementById("calc_batch").value) || 0;
  const costTotal = lines.reduce((sum, l) => sum + l.amount_total, 0);
  const costPerUnit = batch ? costTotal / batch : 0;
  const priceInput = Number(document.getElementById("calc_price").value) || 0;
  const mode = currentCalcPriceMode();

  const pricePerUnit = mode === "unit" ? priceInput : batch ? priceInput / batch : 0;
  const priceTotal = mode === "unit" ? priceInput * batch : priceInput;
  const profitTotal = priceTotal - costTotal;
  const margin = pricePerUnit ? ((pricePerUnit - costPerUnit) / pricePerUnit) * 100 : 0;
  const myShare = profitTotal * (myProfitSharePercent / 100);
  const bizShare = profitTotal - myShare;

  const cls = (n) => (n >= 0 ? "positive" : "negative");
  document.getElementById("calc_summary").innerHTML = `
    <div class="summary-item"><span class="summary-label">Costo total del lote</span><span class="summary-value">${money(costTotal)}</span></div>
    <div class="summary-item"><span class="summary-label">Precio por unidad</span><span class="summary-value">${money(pricePerUnit)}</span></div>
    <div class="summary-item"><span class="summary-label">Ingreso total del lote</span><span class="summary-value">${money(priceTotal)}</span></div>
    <div class="summary-item"><span class="summary-label">Ganancia total del pedido</span><span class="summary-value ${cls(profitTotal)}">${money(profitTotal)}</span></div>
    <div class="summary-item"><span class="summary-label">Emprendimiento (${(100 - myProfitSharePercent).toFixed(0)}%)</span><span class="summary-value ${cls(bizShare)}">${money(bizShare)}</span></div>
    <div class="summary-item"><span class="summary-label">Para vos (${myProfitSharePercent.toFixed(0)}%)</span><span class="summary-value ${cls(myShare)}">${money(myShare)}</span></div>
    <div class="summary-item"><span class="summary-label">Margen</span><span class="summary-value ${cls(margin)}">${margin.toFixed(1)}%</span></div>
  `;
}

function cancelEditCalc() {
  editingCalcId = null;
  document.getElementById("calcForm").reset();
  document.getElementById("calc_batch").value = 50;
  document.getElementById("calc_cost_lines").innerHTML = "";
  document.querySelectorAll("#calc_price_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#calc_price_mode_tabs .tab[data-mode="unit"]').classList.add("is-active");
  document.getElementById("calc_price_label").textContent = "Precio de venta por unidad";
  document.getElementById("calc_filament_preview").textContent = "";
  addCalcCostLineRow();
  updateCalcSummary();
  document.getElementById("calc_form_title").textContent = "Nuevo cálculo";
  document.getElementById("calc_cancel_edit").style.display = "none";
  document.getElementById("calc_submit").textContent = "Guardar cálculo";
}
document.getElementById("calc_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditCalc();
});

function startEditCalc(row) {
  editingCalcId = row.id;
  document.getElementById("calc_name").value = row.name;
  document.getElementById("calc_batch").value = row.batch_size;

  document.querySelectorAll("#calc_price_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#calc_price_mode_tabs .tab[data-mode="total"]').classList.add("is-active");
  document.getElementById("calc_price_label").textContent = "Precio de venta total del lote";
  document.getElementById("calc_price").value = row.sale_price_total;
  document.getElementById("calc_notes").value = row.notes || "";

  document.querySelectorAll("#calc_fixed_items_list input[type=checkbox]").forEach((cb) => (cb.checked = false));
  document.getElementById("calc_filament_grams").value = "";
  document.getElementById("calc_filament_preview").textContent = "";

  document.getElementById("calc_cost_lines").innerHTML = "";
  const lines = row.cost_lines || [];
  if (lines.length) {
    lines.forEach((l) => {
      const total = l.amount_total ?? l.amount_per_unit ?? 0; // amount_per_unit: compatibilidad con cálculos viejos
      addCalcCostLineRow(l.label, total);
      if (l.grams != null) {
        const rows = document.querySelectorAll("#calc_cost_lines .calc-cost-line");
        const lastRow = rows[rows.length - 1];
        lastRow.dataset.filamentLine = "true";
        document.getElementById("calc_filament_grams").value = l.grams;
        if (filamentPricePerKg > 0) {
          document.getElementById("calc_filament_preview").textContent =
            `= ${money(total)} el lote → ${money(row.batch_size ? total / row.batch_size : 0)} por unidad (a ${money(filamentPricePerKg)}/kg, ${row.batch_size} un.)`;
        }
      }
    });
  } else {
    addCalcCostLineRow();
  }
  updateCalcSummary();

  document.getElementById("calc_form_title").textContent = `Editando: ${row.name}`;
  document.getElementById("calc_cancel_edit").style.display = "inline-block";
  document.getElementById("calc_submit").textContent = "Guardar cambios";
  document.getElementById("panel-calculadora").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("calcForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("calc_status");
  const submitBtn = document.getElementById("calc_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const mode = currentCalcPriceMode();
    const batch = Number(document.getElementById("calc_batch").value) || 1;
    const priceInput = Number(document.getElementById("calc_price").value) || 0;
    const salePriceTotal = mode === "unit" ? priceInput * batch : priceInput;

    const payload = {
      name: document.getElementById("calc_name").value.trim(),
      batch_size: batch,
      sale_price_total: salePriceTotal,
      cost_lines: currentCalcCostLines(),
      notes: document.getElementById("calc_notes").value.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = editingCalcId
      ? await sb.from(TABLE_PRICE_CALCS).update(payload).eq("id", editingCalcId)
      : await sb.from(TABLE_PRICE_CALCS).insert(payload);
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditCalc();
    loadCalcs();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadCalcs() {
  const { data, error } = await sb.from(TABLE_PRICE_CALCS).select("*").order("created_at", { ascending: false });
  const list = document.getElementById("calcsList");
  list.innerHTML = "";
  if (error) {
    list.innerHTML = `<p class="hint">Error cargando: ${error.message}</p>`;
    return;
  }
  list._rows = data;
  if (!data.length) {
    list.innerHTML = `<p class="hint">Todavía no guardaste ningún cálculo.</p>`;
    return;
  }

  data.forEach((calc) => {
    const costTotal = (calc.cost_lines || []).reduce((s, l) => s + Number(l.amount_total ?? l.amount_per_unit ?? 0), 0);
    const costPerUnit = calc.batch_size ? costTotal / calc.batch_size : 0;
    const priceTotal = Number(calc.sale_price_total);
    const pricePerUnit = calc.batch_size ? priceTotal / Number(calc.batch_size) : 0;
    const profitTotal = priceTotal - costTotal;
    const margin = pricePerUnit ? ((pricePerUnit - costPerUnit) / pricePerUnit) * 100 : 0;
    const myShare = profitTotal * (myProfitSharePercent / 100);
    const bizShare = profitTotal - myShare;
    const cls = (n) => (n >= 0 ? "positive" : "negative");

    const card = document.createElement("div");
    card.className = "calc-summary-card";
    card.innerHTML = `
      <div class="calc-summary-header">
        <h3>${escapeHtml(calc.name)}</h3>
        <div class="row-actions">
          <button class="btn btn-edit" data-edit-calc="${calc.id}">Editar</button>
          <button class="btn btn-danger" data-delete-calc="${calc.id}">Borrar</button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><span class="summary-label">Lote</span><span class="summary-value">${calc.batch_size} un.</span></div>
        <div class="summary-item"><span class="summary-label">Costo total</span><span class="summary-value">${money(costTotal)}</span></div>
        <div class="summary-item"><span class="summary-label">Precio/u</span><span class="summary-value">${money(pricePerUnit)}</span></div>
        <div class="summary-item"><span class="summary-label">Ganancia total</span><span class="summary-value ${cls(profitTotal)}">${money(profitTotal)}</span></div>
        <div class="summary-item"><span class="summary-label">Emprendimiento</span><span class="summary-value ${cls(bizShare)}">${money(bizShare)}</span></div>
        <div class="summary-item"><span class="summary-label">Para vos</span><span class="summary-value ${cls(myShare)}">${money(myShare)}</span></div>
        <div class="summary-item"><span class="summary-label">Margen</span><span class="summary-value ${cls(margin)}">${margin.toFixed(1)}%</span></div>
      </div>
    `;
    list.appendChild(card);
  });
}

document.getElementById("calcsList").addEventListener("click", async (e) => {
  const rows = document.getElementById("calcsList")._rows;

  const editBtn = e.target.closest("[data-edit-calc]");
  if (editBtn) {
    const row = rows.find((r) => String(r.id) === editBtn.dataset.editCalc);
    if (row) startEditCalc(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-calc]");
  if (delBtn) {
    if (!confirm("¿Borrar este cálculo?")) return;
    await sb.from(TABLE_PRICE_CALCS).delete().eq("id", delBtn.dataset.deleteCalc);
    loadCalcs();
  }
});
