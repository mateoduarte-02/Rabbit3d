import { SUPABASE_URL, STORAGE_BUCKET, createSupabaseClient } from "../shared/js/supabase-config.js";
import { escapeHtml } from "../shared/js/dom-utils.js";
import { driveFileId, driveImageUrl, driveThumbnail } from "../shared/js/drive-utils.js";

const TABLE_PRODUCTS = "rabbit3d_products";
const TABLE_GALLERY = "rabbit3d_gallery";
const TABLE_SETTINGS = "rabbit3d_settings";
const TABLE_CATEGORIES = "rabbit3d_categories";
const TABLE_CATEGORY_MEDIA = "rabbit3d_category_media";
const TABLE_CATEGORY_PRICING = "rabbit3d_category_pricing";

const sb = createSupabaseClient();

// ---------------------------------------------------------------
// ARCHIVOS ESTÁTICOS DEL REPO (GitHub Pages)
// Convención: cualquier ruta que empiece con "assets/" es un archivo
// que vive en el propio repositorio (no en Supabase Storage). No hay
// que subirlo, ni comprimirlo, ni borrarlo de Storage al reemplazar.
// ---------------------------------------------------------------
function isStaticAssetPath(path) {
  return typeof path === "string" && path.trim().startsWith("assets/");
}
function normalizeStaticAssetPath(raw) {
  const trimmed = String(raw || "").trim().replace(/^\/+/, "");
  return trimmed.startsWith("assets/") ? trimmed : null;
}
// Reemplaza a los chequeos sueltos que había antes: solo hay que borrar
// de Storage lo que efectivamente subiste vos (no links de Drive, no
// archivos estáticos del repo).
function isOwnStorageFile(path) {
  return !!path && !/^https?:\/\//i.test(path) && !isStaticAssetPath(path);
}

// ---------------------------------------------------------------
// REORDENAR LISTAS (categorías, galería, fotos/videos por categoría)
// Reasigna sort_order 0..n-1 según la nueva posición — funciona incluso
// si todos los ítems arrancaron con el mismo sort_order por defecto.
// ---------------------------------------------------------------
async function reorderList(table, rows, id, direction, onDone) {
  const idx = rows.findIndex((r) => r.id === id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return;

  const newRows = rows.slice();
  [newRows[idx], newRows[swapWith]] = [newRows[swapWith], newRows[idx]];

  await Promise.all(newRows.map((r, i) => sb.from(table).update({ sort_order: i }).eq("id", r.id)));
  onDone();
}

// ---------------------------------------------------------------
// COMPRESIÓN DE IMÁGENES EN EL NAVEGADOR
// Redimensiona y convierte a WebP antes de subir — así ninguna
// imagen pesada llega a la base compartida con otros proyectos.
// ---------------------------------------------------------------
async function compressImage(file, maxWidth = 1200, quality = 0.75) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality)
  );
  return blob; // Blob ya liviano, listo para subir
}

function randomFileName() {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  return `${id}.webp`;
}

async function uploadToStorage(blob, folder) {
  const path = `${folder}/${randomFileName()}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, blob, {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ---------------------------------------------------------------
// DROPZONE (arrastrar y soltar, con click como alternativa)
// ---------------------------------------------------------------
function setupDropzone(dropzoneEl, inputEl, onFiles) {
  dropzoneEl.addEventListener("click", () => inputEl.click());
  dropzoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputEl.click();
    }
  });
  ["dragenter", "dragover"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzoneEl.classList.add("is-dragover");
    })
  );
  ["dragleave", "dragend", "drop"].forEach((evt) =>
    dropzoneEl.addEventListener(evt, () => dropzoneEl.classList.remove("is-dragover"))
  );
  dropzoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      inputEl.files = files;
      onFiles(files);
    }
  });
  inputEl.addEventListener("change", () => {
    if (inputEl.files.length) onFiles(inputEl.files);
  });
}

// ---------------------------------------------------------------
// SELECTOR DE PUNTO FOCAL (click/arrastre sobre la vista previa)
// ---------------------------------------------------------------
function setupFocalPicker(pickerEl, crosshairEl, initial, onChange, zoomSliderEl, zoomLabelEl) {
  let point = { x: initial.x, y: initial.y, zoom: initial.zoom ?? 100 };

  function paint() {
    crosshairEl.style.left = `${point.x}%`;
    crosshairEl.style.top = `${point.y}%`;
    const img = pickerEl.querySelector(".focal-picker-img");
    img.style.objectPosition = `${point.x}% ${point.y}%`;
    img.style.transformOrigin = `${point.x}% ${point.y}%`; // el zoom se hace desde el punto elegido, no desde el centro
    img.style.transform = `scale(${point.zoom / 100})`;
    if (zoomSliderEl) zoomSliderEl.value = point.zoom;
    if (zoomLabelEl) zoomLabelEl.textContent = `${point.zoom}%`;
  }

  function setFromEvent(clientX, clientY) {
    const rect = pickerEl.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
    point = { ...point, x: Math.round(x), y: Math.round(y) };
    paint();
    onChange(point);
  }

  function pointFromPointerEvent(e) {
    setFromEvent(e.clientX, e.clientY);
  }

  pickerEl.addEventListener("pointerdown", (e) => {
    pickerEl.setPointerCapture(e.pointerId);
    pointFromPointerEvent(e);
    const onMove = (ev) => pointFromPointerEvent(ev);
    pickerEl.addEventListener("pointermove", onMove);
    pickerEl.addEventListener(
      "pointerup",
      () => pickerEl.removeEventListener("pointermove", onMove),
      { once: true }
    );
  });

  if (zoomSliderEl) {
    zoomSliderEl.addEventListener("input", () => {
      point = { ...point, zoom: Number(zoomSliderEl.value) };
      paint();
      onChange(point);
    });
  }

  paint();
  return { get: () => point };
}

// ---------------------------------------------------------------
// AUTENTICACIÓN
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
  loadProducts();
  loadGallery("taller");
  loadSettings();
  loadCategories();
  loadEmployees();
  loadCultsSales();
  loadCultsLastOrder();
}

// Si ya había una sesión activa (recarga de página), entrar directo.
sb.auth.getSession().then(({ data }) => {
  if (data?.session) enterPanel();
});

// ---------------------------------------------------------------
// TABS
// ---------------------------------------------------------------
document.querySelectorAll(".tabs .tab[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tabs .tab[data-tab]").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add("is-active");
  });
});

// ---------------------------------------------------------------
// CATEGORÍAS (pedidos por cantidad): CRUD + fotos/videos por categoría
// ---------------------------------------------------------------
let categoryFocalPicker = null;
let categoryDriveUrl = null;
let editingCategoryId = null;
let editingCategoryOriginal = null;
let activeMediaCategoryId = null;
let activeMediaCategoryName = null;
let categoryMediaFocalPicker = null;
let editingCategoryMediaId = null;
let editingCategoryMediaOriginal = null;

async function handleCategoryFile(file) {
  const fileInput = document.getElementById("c_image");
  const focalWrap = document.getElementById("c_focal_wrap");
  const img = document.getElementById("c_preview_img");
  const label = document.getElementById("c_preview_label");

  label.textContent = "Comprimiendo…";
  focalWrap.style.display = "flex";

  const compressed = await compressImage(file, 1000, 0.75);
  img.src = URL.createObjectURL(compressed);
  label.textContent = `Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
  fileInput._compressedBlob = compressed;

  categoryFocalPicker = setupFocalPicker(
    document.getElementById("c_focal_picker"),
    document.getElementById("c_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("c_focal_zoom"),
    document.getElementById("c_focal_zoom_label")
  );
}

setupDropzone(document.getElementById("c_dropzone"), document.getElementById("c_image"), (files) =>
  handleCategoryFile(files[0])
);

// Portada: subir archivo / link de Drive / ruta en GitHub.
document.querySelectorAll("#c_image_source_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#c_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const source = tab.dataset.isource;
    document.getElementById("c_image_upload_block").style.display = source === "upload" ? "block" : "none";
    document.getElementById("c_image_drive_block").style.display = source === "drive" ? "block" : "none";
    document.getElementById("c_image_github_block").style.display = source === "github" ? "block" : "none";
    document.getElementById("c_focal_wrap").style.display = "none";
    categoryFocalPicker = null;
    categoryDriveUrl = null;
  });
});

document.getElementById("c_image_drive_load").addEventListener("click", () => {
  const status = document.getElementById("c_status");
  const rawUrl = document.getElementById("c_image_drive_url").value.trim();
  const directUrl = driveImageUrl(rawUrl);
  if (!directUrl) {
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  categoryDriveUrl = directUrl;

  const focalWrap = document.getElementById("c_focal_wrap");
  const img = document.getElementById("c_preview_img");
  const label = document.getElementById("c_preview_label");
  img.src = directUrl;
  label.textContent = "Vista previa desde Drive";
  focalWrap.style.display = "flex";

  categoryFocalPicker = setupFocalPicker(
    document.getElementById("c_focal_picker"),
    document.getElementById("c_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("c_focal_zoom"),
    document.getElementById("c_focal_zoom_label")
  );
});

document.getElementById("c_image_github_load").addEventListener("click", () => {
  const status = document.getElementById("c_status");
  const path = normalizeStaticAssetPath(document.getElementById("c_image_github_path").value);
  if (!path) {
    status.className = "status err";
    status.textContent = 'La ruta tiene que empezar con "assets/", ej: assets/categorias/foto.jpg';
    return;
  }
  status.className = "";
  status.textContent = "";
  categoryDriveUrl = path;

  const focalWrap = document.getElementById("c_focal_wrap");
  const img = document.getElementById("c_preview_img");
  const label = document.getElementById("c_preview_label");
  img.src = path;
  label.textContent = "Vista previa desde el repositorio";
  focalWrap.style.display = "flex";

  categoryFocalPicker = setupFocalPicker(
    document.getElementById("c_focal_picker"),
    document.getElementById("c_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("c_focal_zoom"),
    document.getElementById("c_focal_zoom_label")
  );
});

function resetCategoryImageSource() {
  document.querySelectorAll("#c_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#c_image_source_tabs .tab[data-isource="upload"]').classList.add("is-active");
  document.getElementById("c_image_upload_block").style.display = "block";
  document.getElementById("c_image_drive_block").style.display = "none";
  document.getElementById("c_image_github_block").style.display = "none";
  document.getElementById("c_image_drive_url").value = "";
  document.getElementById("c_image_github_path").value = "";
  categoryDriveUrl = null;
}

function startEditCategory(c) {
  editingCategoryId = c.id;
  editingCategoryOriginal = c;

  document.getElementById("c_name").value = c.name || "";
  document.getElementById("c_description").value = c.description || "";
  document.getElementById("c_price_note").value = c.price_note || "";
  document.getElementById("c_active").checked = !!c.is_active;

  document.getElementById("c_image")._compressedBlob = null;
  resetCategoryImageSource();
  const focalWrap = document.getElementById("c_focal_wrap");
  const img = document.getElementById("c_preview_img");
  const label = document.getElementById("c_preview_label");
  if (c.cover_image_path) {
    img.src = imageUrl(c.cover_image_path) || "";
    label.textContent = "Foto actual — soltá una nueva arriba (o pegá un link de Drive) para reemplazarla";
    focalWrap.style.display = "flex";
  } else {
    focalWrap.style.display = "none";
  }
  categoryFocalPicker = setupFocalPicker(
    document.getElementById("c_focal_picker"),
    document.getElementById("c_focal_crosshair"),
    { x: c.cover_focal_x ?? 50, y: c.cover_focal_y ?? 50, zoom: c.cover_zoom ?? 100},
    () => {},
    document.getElementById("c_focal_zoom"),
    document.getElementById("c_focal_zoom_label")
  );

  document.getElementById("c_form_title").textContent = `Editando: ${c.name}`;
  document.getElementById("c_cancel_edit").style.display = "inline-block";
  document.getElementById("c_submit").textContent = "Guardar cambios";
  document.getElementById("panel-categorias").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditCategory() {
  editingCategoryId = null;
  editingCategoryOriginal = null;
  categoryFocalPicker = null;
  document.getElementById("categoryForm").reset();
  document.getElementById("c_active").checked = true;
  document.getElementById("c_focal_wrap").style.display = "none";
  resetCategoryImageSource();
  document.getElementById("c_form_title").textContent = "Nueva categoría";
  document.getElementById("c_cancel_edit").style.display = "none";
  document.getElementById("c_submit").textContent = "Crear categoría";
}
document.getElementById("c_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditCategory();
});

document.getElementById("categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("c_status");
  const submitBtn = document.getElementById("c_submit");
  const fileInput = document.getElementById("c_image");
  const isEditing = !!editingCategoryId;
  const activeCoverSource = document.querySelector("#c_image_source_tabs .tab.is-active")?.dataset.isource;
  const isDriveSource = activeCoverSource === "drive" || activeCoverSource === "github";

  try {
    submitBtn.disabled = true;
    status.className = "status busy";

    let imagePath = isEditing ? editingCategoryOriginal.cover_image_path : null;
    let focal = categoryFocalPicker ? categoryFocalPicker.get() : { x: 50, y: 50 };
    const newFile = fileInput.files[0];

    if (isDriveSource && categoryDriveUrl) {
      if (isEditing && isOwnStorageFile(editingCategoryOriginal.cover_image_path)) {
        await sb.storage.from(STORAGE_BUCKET).remove([editingCategoryOriginal.cover_image_path]);
      }
      imagePath = categoryDriveUrl;
    } else if (newFile) {
      status.textContent = "Optimizando y subiendo foto…";
      const blob = fileInput._compressedBlob || (await compressImage(newFile, 1000, 0.75));
      imagePath = await uploadToStorage(blob, "categorias");
      if (isEditing && isOwnStorageFile(editingCategoryOriginal.cover_image_path)) {
        await sb.storage.from(STORAGE_BUCKET).remove([editingCategoryOriginal.cover_image_path]);
      }
    }

    const payload = {
      name: document.getElementById("c_name").value.trim(),
      description: document.getElementById("c_description").value.trim() || null,
      price_note: document.getElementById("c_price_note").value.trim() || null,
      is_active: document.getElementById("c_active").checked,
      cover_image_path: imagePath,
      cover_focal_x: focal.x,
      cover_focal_y: focal.y,
      cover_zoom: focal.zoom,
    };

    status.textContent = isEditing ? "Guardando cambios…" : "Creando categoría…";
    const { error } = isEditing
      ? await sb.from(TABLE_CATEGORIES).update(payload).eq("id", editingCategoryId)
      : await sb.from(TABLE_CATEGORIES).insert(payload);
    if (error) throw error;

    status.className = "status ok";
    status.textContent = isEditing ? "Categoría actualizada correctamente." : "Categoría creada correctamente.";
    cancelEditCategory();
    loadCategories();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadCategories() {
  const { data, error } = await sb
    .from(TABLE_CATEGORIES)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  const tbody = document.getElementById("categoriesTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error cargando categorías: ${error.message}</td></tr>`;
    return;
  }
  tbody._rows = data;

  for (const [i, c] of data.entries()) {
    let url = imageUrl(c.cover_image_path);
    let isFallback = false;

    // Si no hay portada, usamos de respaldo la primera foto (o miniatura
    // de video) que haya en "Fotos/videos" de esa categoría — así el
    // panel muestra lo mismo que ya ve el visitante en el sitio público.
    if (!url) {
      const { data: media } = await sb
        .from(TABLE_CATEGORY_MEDIA)
        .select("*")
        .eq("category_id", c.id)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      const imageItem = (media || []).find((m) => m.media_type === "image");
      if (imageItem) {
        url = imageUrl(imageItem.image_path);
        isFallback = true;
      } else {
        const videoItem = (media || []).find(
          (m) => m.media_type === "video" && (driveThumbnail(m.video_url) || youtubeThumbnail(m.video_url))
        );
        if (videoItem) {
          url = driveThumbnail(videoItem.video_url) || youtubeThumbnail(videoItem.video_url);
          isFallback = true;
        }
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        ${
          url
            ? `<img class="cat-cover-img" src="${url}" alt="Portada de ${escapeHtml(c.name)}">`
            : `<div class="cat-cover-empty">Sin foto</div>`
        }
      </td>
      <td>${escapeHtml(c.name)}</td>
      <td>${c.is_active ? "Sí" : "No"}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-small" data-move-category="${c.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-small" data-move-category="${c.id}" data-dir="down" ${i === data.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn-edit" data-manage-pricing="${c.id}">Precios</button>
        <button class="btn btn-edit" data-manage-media="${c.id}">Fotos/videos</button>
        <button class="btn btn-edit" data-edit-category="${c.id}">Editar</button>
        <button class="btn btn-danger" data-delete-category="${c.id}" data-path="${c.cover_image_path || ""}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById("categoriesTableBody").addEventListener("click", async (e) => {
  const rows = document.getElementById("categoriesTableBody")._rows;

  const moveBtn = e.target.closest("[data-move-category]");
  if (moveBtn) {
    await reorderList(TABLE_CATEGORIES, rows, Number(moveBtn.dataset.moveCategory), moveBtn.dataset.dir, loadCategories);
    return;
  }

  const editBtn = e.target.closest("[data-edit-category]");
  if (editBtn) {
    const row = rows.find((r) => String(r.id) === editBtn.dataset.editCategory);
    if (row) startEditCategory(row);
    return;
  }

  const mediaBtn = e.target.closest("[data-manage-media]");
  if (mediaBtn) {
    const row = rows.find((r) => String(r.id) === mediaBtn.dataset.manageMedia);
    if (row) openCategoryMedia(row);
    return;
  }

  const pricingBtn = e.target.closest("[data-manage-pricing]");
  if (pricingBtn) {
    const row = rows.find((r) => String(r.id) === pricingBtn.dataset.managePricing);
    if (row) openCategoryPricing(row);
    return;
  }

  const delBtn = e.target.closest("[data-delete-category]");
  if (delBtn) {
    if (!confirm("¿Borrar esta categoría? También se borran sus fotos y videos.")) return;
    const path = delBtn.dataset.path;
    if (isOwnStorageFile(path)) await sb.storage.from(STORAGE_BUCKET).remove([path]);
    await sb.from(TABLE_CATEGORIES).delete().eq("id", delBtn.dataset.deleteCategory);
    if (activeMediaCategoryId === Number(delBtn.dataset.deleteCategory)) {
      document.getElementById("categoryMediaCard").style.display = "none";
      activeMediaCategoryId = null;
    }
    loadCategories();
  }
});

// ---------- Fotos y videos de una categoría puntual ----------
function openCategoryMedia(category) {
  activeMediaCategoryId = category.id;
  activeMediaCategoryName = category.name;
  document.getElementById("cm_category_name").textContent = category.name;
  document.getElementById("categoryMediaCard").style.display = "block";
  document.getElementById("categoryMediaCard").scrollIntoView({ behavior: "smooth", block: "start" });
  resetCategoryMediaForm();
  loadCategoryMedia();
}

document.querySelectorAll("#cm_type_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#cm_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const isImage = tab.dataset.mtype === "image";
    document.getElementById("cm_image_form").style.display = isImage ? "block" : "none";
    document.getElementById("cm_video_form").style.display = isImage ? "none" : "block";
  });
});

// Dentro de "Foto": subir archivo / link de Drive / ruta en GitHub.
document.querySelectorAll("#cm_image_source_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#cm_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const source = tab.dataset.isource;
    document.getElementById("cm_image_upload_block").style.display = source === "upload" ? "block" : "none";
    document.getElementById("cm_image_drive_block").style.display = source === "drive" ? "block" : "none";
    document.getElementById("cm_image_github_block").style.display = source === "github" ? "block" : "none";
    document.getElementById("cm_focal_wrap").style.display = "none";
    categoryMediaFocalPicker = null;
  });
});

function resetCategoryMediaForm() {
  editingCategoryMediaId = null;
  editingCategoryMediaOriginal = null;
  document.getElementById("cm_image").value = "";
  document.getElementById("cm_image")._compressedBlob = null;
  document.getElementById("cm_image_drive_url").value = "";
  document.getElementById("cm_image_github_path").value = "";
  document.getElementById("cm_focal_wrap").style.display = "none";
  document.getElementById("cm_video_url").value = "";
  document.getElementById("cm_caption").value = "";
  categoryMediaFocalPicker = null;
  categoryMediaDriveUrl = null;
  document.querySelectorAll("#cm_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#cm_image_source_tabs .tab[data-isource="upload"]').classList.add("is-active");
  document.getElementById("cm_image_upload_block").style.display = "block";
  document.getElementById("cm_image_drive_block").style.display = "none";
  document.getElementById("cm_image_github_block").style.display = "none";
  document.querySelectorAll("#cm_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#cm_type_tabs .tab[data-mtype="image"]').classList.add("is-active");
  document.getElementById("cm_image_form").style.display = "block";
  document.getElementById("cm_video_form").style.display = "none";
  document.getElementById("cm_media_form_title").textContent = "Nueva foto o video";
  document.getElementById("cm_media_cancel_edit").style.display = "none";
  document.getElementById("cm_submit").textContent = "Agregar";
}

document.getElementById("cm_media_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  resetCategoryMediaForm();
});

function startEditCategoryMedia(m) {
  resetCategoryMediaForm();
  editingCategoryMediaId = m.id;
  editingCategoryMediaOriginal = m;

  document.querySelectorAll("#cm_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector(`#cm_type_tabs .tab[data-mtype="${m.media_type}"]`).classList.add("is-active");
  document.getElementById("cm_image_form").style.display = m.media_type === "image" ? "block" : "none";
  document.getElementById("cm_video_form").style.display = m.media_type === "image" ? "none" : "block";

  document.getElementById("cm_caption").value = m.caption || "";

  if (m.media_type === "image") {
    const focalWrap = document.getElementById("cm_focal_wrap");
    const img = document.getElementById("cm_preview_img");
    const label = document.getElementById("cm_preview_label");
    img.src = imageUrl(m.image_path) || "";
    label.textContent = "Foto actual — soltá una nueva arriba (o pegá un link) para reemplazarla";
    focalWrap.style.display = "flex";
    categoryMediaFocalPicker = setupFocalPicker(
      document.getElementById("cm_focal_picker"),
      document.getElementById("cm_focal_crosshair"),
      { x: m.focal_x ?? 50, y: m.focal_y ?? 50, zoom: m.zoom ?? 100 },
      () => {},
      document.getElementById("cm_focal_zoom"),
      document.getElementById("cm_focal_zoom_label")
    );
  } else {
    document.getElementById("cm_video_url").value = m.video_url || "";
  }

  document.getElementById("cm_media_form_title").textContent = "Editando";
  document.getElementById("cm_media_cancel_edit").style.display = "inline-block";
  document.getElementById("cm_submit").textContent = "Guardar cambios";
  document.getElementById("categoryMediaCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleCategoryMediaFile(file) {
  const focalWrap = document.getElementById("cm_focal_wrap");
  const img = document.getElementById("cm_preview_img");
  const label = document.getElementById("cm_preview_label");
  label.textContent = "Comprimiendo…";
  focalWrap.style.display = "flex";

  const compressed = await compressImage(file, 1200, 0.75);
  img.src = URL.createObjectURL(compressed);
  label.textContent = `Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
  document.getElementById("cm_image")._compressedBlob = compressed;

  categoryMediaFocalPicker = setupFocalPicker(
    document.getElementById("cm_focal_picker"),
    document.getElementById("cm_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("cm_focal_zoom"),
    document.getElementById("cm_focal_zoom_label")
  );
}
setupDropzone(document.getElementById("cm_dropzone"), document.getElementById("cm_image"), (files) =>
  handleCategoryMediaFile(files[0])
);

let categoryMediaDriveUrl = null;

document.getElementById("cm_image_drive_load").addEventListener("click", () => {
  const status = document.getElementById("cm_status");
  const rawUrl = document.getElementById("cm_image_drive_url").value.trim();
  const directUrl = driveImageUrl(rawUrl);
  if (!directUrl) {
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  categoryMediaDriveUrl = directUrl;

  const focalWrap = document.getElementById("cm_focal_wrap");
  const img = document.getElementById("cm_preview_img");
  const label = document.getElementById("cm_preview_label");
  img.src = directUrl;
  label.textContent = "Vista previa desde Drive";
  focalWrap.style.display = "flex";

  categoryMediaFocalPicker = setupFocalPicker(
    document.getElementById("cm_focal_picker"),
    document.getElementById("cm_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("cm_focal_zoom"),
    document.getElementById("cm_focal_zoom_label")
  );
});

document.getElementById("cm_image_github_load").addEventListener("click", () => {
  const status = document.getElementById("cm_status");
  const path = normalizeStaticAssetPath(document.getElementById("cm_image_github_path").value);
  if (!path) {
    status.className = "status err";
    status.textContent = 'La ruta tiene que empezar con "assets/", ej: assets/categorias/foto.jpg';
    return;
  }
  status.className = "";
  status.textContent = "";
  categoryMediaDriveUrl = path;

  const focalWrap = document.getElementById("cm_focal_wrap");
  const img = document.getElementById("cm_preview_img");
  const label = document.getElementById("cm_preview_label");
  img.src = path;
  label.textContent = "Vista previa desde el repositorio";
  focalWrap.style.display = "flex";

  categoryMediaFocalPicker = setupFocalPicker(
    document.getElementById("cm_focal_picker"),
    document.getElementById("cm_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("cm_focal_zoom"),
    document.getElementById("cm_focal_zoom_label")
  );
});

document.getElementById("cm_submit").addEventListener("click", async () => {
  const status = document.getElementById("cm_status");
  const isImageTab = document.querySelector('#cm_type_tabs .tab[data-mtype="image"]').classList.contains("is-active");
  const caption = document.getElementById("cm_caption").value.trim() || null;

  try {
    status.className = "status busy";

    if (isImageTab) {
      const activeMediaImageSource = document.querySelector("#cm_image_source_tabs .tab.is-active")?.dataset.isource;
      const isDriveSource = activeMediaImageSource === "drive" || activeMediaImageSource === "github";
      const fileInput = document.getElementById("cm_image");
      const hasNewFile = !isDriveSource && fileInput.files[0];
      const hasNewDriveUrl = isDriveSource && categoryMediaDriveUrl;

      let imagePath;
      let focal = categoryMediaFocalPicker ? categoryMediaFocalPicker.get() : { x: 50, y: 50, zoom: 100 };

      if (editingCategoryMediaId && !hasNewFile && !hasNewDriveUrl) {
        // No se cargó ninguna fuente nueva: se mantiene la foto actual,
        // solo se actualiza el foco/zoom/caption.
        imagePath = editingCategoryMediaOriginal.image_path;
      } else if (isDriveSource) {
        if (!categoryMediaDriveUrl) {
          status.className = "status err";
          status.textContent = "Cargá la vista previa primero (Drive o GitHub).";
          return;
        }
        imagePath = categoryMediaDriveUrl; // URL completa o ruta del repo — se guarda tal cual, sin subir a Storage
      } else {
        const file = fileInput.files[0];
        if (!file) {
          status.className = "status err";
          status.textContent = "Elegí una foto primero.";
          return;
        }
        status.textContent = "Subiendo foto…";
        const blob = fileInput._compressedBlob || (await compressImage(file, 1200, 0.75));
        imagePath = await uploadToStorage(blob, "categorias");
      }

      const payload = {
        category_id: activeMediaCategoryId,
        media_type: "image",
        image_path: imagePath,
        focal_x: focal.x,
        focal_y: focal.y,
        zoom: focal.zoom,
        caption,
      };

      if (editingCategoryMediaId) {
        // Si se reemplazó la foto por una nueva y la anterior era propia
        // (subida a Storage), se borra la vieja para no dejar basura.
        if (
          (hasNewFile || hasNewDriveUrl) &&
          isOwnStorageFile(editingCategoryMediaOriginal.image_path) &&
          editingCategoryMediaOriginal.image_path !== imagePath
        ) {
          await sb.storage.from(STORAGE_BUCKET).remove([editingCategoryMediaOriginal.image_path]);
        }
        const { error } = await sb.from(TABLE_CATEGORY_MEDIA).update(payload).eq("id", editingCategoryMediaId);
        if (error) throw error;
      } else {
        const { error } = await sb.from(TABLE_CATEGORY_MEDIA).insert(payload);
        if (error) throw error;
      }
    } else {
      const videoUrl = document.getElementById("cm_video_url").value.trim();
      if (!videoUrl) {
        status.className = "status err";
        status.textContent = "Pegá el link del video.";
        return;
      }
      status.textContent = "Guardando video…";
      const payload = { category_id: activeMediaCategoryId, media_type: "video", video_url: videoUrl, caption };
      const { error } = editingCategoryMediaId
        ? await sb.from(TABLE_CATEGORY_MEDIA).update(payload).eq("id", editingCategoryMediaId)
        : await sb.from(TABLE_CATEGORY_MEDIA).insert(payload);
      if (error) throw error;
    }

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    resetCategoryMediaForm();
    loadCategoryMedia();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  }
});

function youtubeThumbnail(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null;
}

async function loadCategoryMedia() {
  const { data, error } = await sb
    .from(TABLE_CATEGORY_MEDIA)
    .select("*")
    .eq("category_id", activeMediaCategoryId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  const list = document.getElementById("cm_media_list");
  list.innerHTML = "";
  if (error) {
    list.innerHTML = `<p class="hint">Error cargando: ${error.message}</p>`;
    return;
  }
  list._rows = data;
  data.forEach((m, i) => {
    const div = document.createElement("div");
    const moveBtns = `
      <div class="row-actions" style="margin-top:8px">
        <button class="btn btn-ghost btn-small" data-move-media="${m.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-small" data-move-media="${m.id}" data-dir="down" ${i === data.length - 1 ? "disabled" : ""}>↓</button>
      </div>`;
    if (m.media_type === "image") {
      div.className = "focal-list-item";
      div.innerHTML = `
        <div class="focal-picker" style="aspect-ratio:4/3; max-width:140px; cursor:default">
          <img class="focal-picker-img" src="${imageUrl(m.image_path)}" alt="" style="object-position:${m.focal_x}% ${m.focal_y}%; transform:scale(${(m.zoom ?? 100) / 100})">
        </div>
        <div class="focal-info">
          <div class="file-name">${escapeHtml(m.caption || "Foto")}</div>
          <button class="btn btn-edit" data-edit-media="${m.id}">Editar</button>
          <button class="btn btn-danger" data-delete-media="${m.id}" data-path="${m.image_path}">Borrar</button>
          ${moveBtns}
        </div>`;
    } else {
      const thumb = driveThumbnail(m.video_url) || youtubeThumbnail(m.video_url);
      div.className = "media-video-item";
      div.innerHTML = `
        <div class="media-video-thumb">${thumb ? `<img src="${thumb}" alt="">` : "🎬"}</div>
        <div class="media-video-info">
          <div class="file-name">${escapeHtml(m.caption || "Video")}</div>
          <a href="${m.video_url}" target="_blank" rel="noopener">${escapeHtml(m.video_url)}</a>
          ${moveBtns}
        </div>
        <button class="btn btn-edit" data-edit-media="${m.id}">Editar</button>
        <button class="btn btn-danger" data-delete-media="${m.id}">Borrar</button>`;
    }
    list.appendChild(div);
  });
}

document.getElementById("cm_media_list").addEventListener("click", async (e) => {
  const moveBtn = e.target.closest("[data-move-media]");
  if (moveBtn) {
    const rows = document.getElementById("cm_media_list")._rows;
    await reorderList(TABLE_CATEGORY_MEDIA, rows, Number(moveBtn.dataset.moveMedia), moveBtn.dataset.dir, loadCategoryMedia);
    return;
  }
  const editBtn = e.target.closest("[data-edit-media]");
  if (editBtn) {
    const rows = document.getElementById("cm_media_list")._rows;
    const row = rows.find((r) => String(r.id) === editBtn.dataset.editMedia);
    if (row) startEditCategoryMedia(row);
    return;
  }
  const btn = e.target.closest("[data-delete-media]");
  if (!btn) return;
  if (!confirm("¿Borrar este elemento?")) return;
  const path = btn.dataset.path;
  if (isOwnStorageFile(path)) await sb.storage.from(STORAGE_BUCKET).remove([path]);
  await sb.from(TABLE_CATEGORY_MEDIA).delete().eq("id", btn.dataset.deleteMedia);
  loadCategoryMedia();
});

// ---------------------------------------------------------------
// PRECIOS POR CANTIDAD de cada categoría. El cliente solo va a ver
// total_price — unit_price es de referencia interna (y además está
// bloqueado a nivel de base de datos para que "anon" no pueda leerlo).
// ---------------------------------------------------------------
let activePricingCategoryId = null;
let editingPricingId = null;

function openCategoryPricing(category) {
  activePricingCategoryId = category.id;
  document.getElementById("cp_category_name").textContent = category.name;
  document.getElementById("categoryPricingCard").style.display = "block";
  document.getElementById("categoryPricingCard").scrollIntoView({ behavior: "smooth", block: "start" });
  cancelEditPricing();
  loadCategoryPricing();
}

document.querySelectorAll("#cp_mode_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#cp_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    updatePricingPreview();
  });
});
document.getElementById("cp_quantity").addEventListener("input", updatePricingPreview);
document.getElementById("cp_price").addEventListener("input", updatePricingPreview);

function currentPricingMode() {
  return document.querySelector("#cp_mode_tabs .tab.is-active").dataset.mode;
}

function updatePricingPreview() {
  const mode = currentPricingMode();
  const label = document.getElementById("cp_price_label");
  const preview = document.getElementById("cp_calc_preview");
  const quantity = Number(document.getElementById("cp_quantity").value) || 0;
  const price = Number(document.getElementById("cp_price").value) || 0;

  if (mode === "unit") {
    label.textContent = "Precio por unidad";
    document.getElementById("cp_price").placeholder = "Ej: 900";
    const total = price * quantity;
    preview.textContent = quantity && price ? `= $${total.toLocaleString("es-AR")} el pack de ${quantity} unidades` : "";
  } else {
    label.textContent = "Precio total del pack";
    document.getElementById("cp_price").placeholder = "Ej: 45000";
    const unit = quantity ? price / quantity : 0;
    preview.textContent = quantity && price ? `= $${unit.toLocaleString("es-AR", { maximumFractionDigits: 2 })} por unidad` : "";
  }
}
updatePricingPreview();

function startEditPricing(row) {
  editingPricingId = row.id;
  document.getElementById("cp_quantity").value = row.quantity;
  document.querySelectorAll("#cp_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#cp_mode_tabs .tab[data-mode="total"]').classList.add("is-active");
  document.getElementById("cp_price").value = row.total_price;
  updatePricingPreview();
  document.getElementById("cp_submit").textContent = "Guardar cambios";
  document.getElementById("cp_cancel_edit").style.display = "inline-block";
}

function cancelEditPricing() {
  editingPricingId = null;
  document.getElementById("pricingForm").reset();
  document.getElementById("cp_quantity").value = 50;
  document.querySelectorAll("#cp_mode_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#cp_mode_tabs .tab[data-mode="unit"]').classList.add("is-active");
  updatePricingPreview();
  document.getElementById("cp_submit").textContent = "Agregar precio";
  document.getElementById("cp_cancel_edit").style.display = "none";
}
document.getElementById("cp_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditPricing();
});

document.getElementById("pricingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("cp_status");
  const submitBtn = document.getElementById("cp_submit");
  const quantity = Number(document.getElementById("cp_quantity").value);
  const price = Number(document.getElementById("cp_price").value);
  const mode = currentPricingMode();

  if (!quantity || !price) {
    status.className = "status err";
    status.textContent = "Completá la cantidad y el precio.";
    return;
  }

  const unit_price = mode === "unit" ? price : price / quantity;
  const total_price = mode === "unit" ? price * quantity : price;

  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const payload = { category_id: activePricingCategoryId, quantity, unit_price, total_price };
    const { error } = editingPricingId
      ? await sb.from(TABLE_CATEGORY_PRICING).update(payload).eq("id", editingPricingId)
      : await sb.from(TABLE_CATEGORY_PRICING).upsert(payload, { onConflict: "category_id,quantity" });
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditPricing();
    loadCategoryPricing();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadCategoryPricing() {
  const { data, error } = await sb
    .from(TABLE_CATEGORY_PRICING)
    .select("*")
    .eq("category_id", activePricingCategoryId)
    .order("sort_order", { ascending: true })
    .order("quantity", { ascending: true });
  const tbody = document.getElementById("pricingTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error cargando precios: ${error.message}</td></tr>`;
    return;
  }
  tbody._rows = data;
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4">Todavía no cargaste ningún precio para esta categoría.</td></tr>`;
    return;
  }
  data.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.quantity}</td>
      <td>$${Number(p.unit_price).toLocaleString("es-AR", { maximumFractionDigits: 2 })}</td>
      <td>$${Number(p.total_price).toLocaleString("es-AR")}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-small" data-move-pricing="${p.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-small" data-move-pricing="${p.id}" data-dir="down" ${i === data.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn-edit" data-edit-pricing="${p.id}">Editar</button>
        <button class="btn btn-danger" data-delete-pricing="${p.id}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("pricingTableBody").addEventListener("click", async (e) => {
  const rows = document.getElementById("pricingTableBody")._rows || [];

  const moveBtn = e.target.closest("[data-move-pricing]");
  if (moveBtn) {
    await reorderList(TABLE_CATEGORY_PRICING, rows, Number(moveBtn.dataset.movePricing), moveBtn.dataset.dir, loadCategoryPricing);
    return;
  }

  const editBtn = e.target.closest("[data-edit-pricing]");
  if (editBtn) {
    const row = rows.find((r) => String(r.id) === editBtn.dataset.editPricing);
    if (row) startEditPricing(row);
    return;
  }

  const delBtn = e.target.closest("[data-delete-pricing]");
  if (delBtn) {
    if (!confirm("¿Borrar este precio?")) return;
    await sb.from(TABLE_CATEGORY_PRICING).delete().eq("id", delBtn.dataset.deletePricing);
    loadCategoryPricing();
  }
});

// ---------------------------------------------------------------
// PRODUCTOS: preview + punto focal + submit + listado
// ---------------------------------------------------------------

// Los packs mayoristas son solo para llaveros: el checkbox y los campos
// de pack se habilitan únicamente con esa categoría seleccionada.
function syncWholesaleAvailability() {
  const category = document.getElementById("p_category").value;
  const checkbox = document.getElementById("p_wholesale");
  const hint = document.getElementById("p_wholesale_hint");
  const fields = document.getElementById("p_wholesale_fields");
  const isLlaveros = category === "llaveros";

  checkbox.disabled = !isLlaveros;
  hint.style.display = isLlaveros ? "none" : "block";
  if (!isLlaveros) {
    checkbox.checked = false;
    fields.style.display = "none";
    document.getElementById("p_pack_sizes").value = "";
    document.getElementById("p_wholesale_price").value = "";
  } else {
    fields.style.display = checkbox.checked ? "grid" : "none";
  }
}
document.getElementById("p_category").addEventListener("change", syncWholesaleAvailability);
document.getElementById("p_wholesale").addEventListener("change", syncWholesaleAvailability);
syncWholesaleAvailability(); // estado inicial al cargar la página

let productFocalPicker = null; // se crea recién cuando hay una imagen elegida
let editingProductId = null;
let editingProductOriginal = null;

async function handleProductFile(file) {
  const fileInput = document.getElementById("p_image");
  const focalWrap = document.getElementById("p_focal_wrap");
  const img = document.getElementById("p_preview_img");
  const sizes = document.getElementById("p_preview_sizes");

  sizes.textContent = "Comprimiendo…";
  focalWrap.style.display = "flex";

  const compressed = await compressImage(file, 1000, 0.75);
  img.src = URL.createObjectURL(compressed);
  sizes.textContent = `Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
  fileInput._compressedBlob = compressed;

  productFocalPicker = setupFocalPicker(
    document.getElementById("p_focal_picker"),
    document.getElementById("p_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("p_focal_zoom"),
    document.getElementById("p_focal_zoom_label")
  );
}

setupDropzone(document.getElementById("p_dropzone"), document.getElementById("p_image"), (files) =>
  handleProductFile(files[0])
);

function startEditProduct(p) {
  editingProductId = p.id;
  editingProductOriginal = p;

  document.getElementById("p_name").value = p.name || "";
  document.getElementById("p_description").value = p.description || "";
  document.getElementById("p_category").value = p.category;
  document.getElementById("p_price").value = p.price_label || "";
  document.getElementById("p_wholesale").checked = !!p.allows_wholesale;
  document.getElementById("p_pack_sizes").value = p.wholesale_pack_sizes || "";
  document.getElementById("p_wholesale_price").value = p.wholesale_price_label || "";
  syncWholesaleAvailability();
  document.getElementById("p_wholesale_fields").style.display = p.allows_wholesale ? "grid" : "none";

  // Muestra la imagen YA guardada (no una nueva) hasta que se suelte un reemplazo.
  document.getElementById("p_image")._compressedBlob = null;
  const focalWrap = document.getElementById("p_focal_wrap");
  const img = document.getElementById("p_preview_img");
  const sizes = document.getElementById("p_preview_sizes");
  img.src = imageUrl(p.image_path) || "";
  sizes.textContent = "Foto actual — soltá una nueva arriba para reemplazarla";
  focalWrap.style.display = "flex";
  productFocalPicker = setupFocalPicker(
    document.getElementById("p_focal_picker"),
    document.getElementById("p_focal_crosshair"),
    { x: p.focal_x ?? 50, y: p.focal_y ?? 50, zoom: p.zoom ?? 100},
    () => {},
    document.getElementById("p_focal_zoom"),
    document.getElementById("p_focal_zoom_label")
  );

  document.getElementById("p_form_title").textContent = `Editando: ${p.name}`;
  document.getElementById("p_cancel_edit").style.display = "inline-block";
  document.getElementById("p_submit").textContent = "Guardar cambios";
  document.getElementById("panel-productos").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditProduct() {
  editingProductId = null;
  editingProductOriginal = null;
  productFocalPicker = null;
  document.getElementById("productForm").reset();
  syncWholesaleAvailability();
  document.getElementById("p_focal_wrap").style.display = "none";
  document.getElementById("p_form_title").textContent = "Nuevo producto";
  document.getElementById("p_cancel_edit").style.display = "none";
  document.getElementById("p_submit").textContent = "Subir producto";
}
document.getElementById("p_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditProduct();
});

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("p_status");
  const submitBtn = document.getElementById("p_submit");
  const fileInput = document.getElementById("p_image");
  const isEditing = !!editingProductId;

  if (!isEditing && !fileInput.files[0]) {
    status.className = "status err";
    status.textContent = "Elegí una foto para el producto.";
    return;
  }

  try {
    submitBtn.disabled = true;
    status.className = "status busy";

    let imagePath = isEditing ? editingProductOriginal.image_path : null;
    let focal = productFocalPicker ? productFocalPicker.get() : { x: 50, y: 50 };
    const newFile = fileInput.files[0];

    if (newFile || !isEditing) {
      status.textContent = "Optimizando y subiendo imagen…";
      const blob = fileInput._compressedBlob || (await compressImage(fileInput.files[0], 1000, 0.75));
      imagePath = await uploadToStorage(blob, "productos");
      if (isEditing && isOwnStorageFile(editingProductOriginal.image_path)) {
        await sb.storage.from(STORAGE_BUCKET).remove([editingProductOriginal.image_path]);
      }
    }

    const payload = {
      name: document.getElementById("p_name").value.trim(),
      description: document.getElementById("p_description").value.trim() || null,
      category: document.getElementById("p_category").value,
      price_label: document.getElementById("p_price").value.trim() || null,
      allows_wholesale: document.getElementById("p_wholesale").checked,
      wholesale_pack_sizes: document.getElementById("p_pack_sizes").value.trim() || null,
      wholesale_price_label: document.getElementById("p_wholesale_price").value.trim() || null,
      image_path: imagePath,
      focal_x: focal.x,
      focal_y: focal.y,
      zoom: focal.zoom,
    };

    status.textContent = isEditing ? "Guardando cambios…" : "Guardando producto…";
    const { error } = isEditing
      ? await sb.from(TABLE_PRODUCTS).update(payload).eq("id", editingProductId)
      : await sb.from(TABLE_PRODUCTS).insert({ ...payload, is_active: true });
    if (error) throw error;

    status.className = "status ok";
    status.textContent = isEditing ? "Producto actualizado correctamente." : "Producto cargado correctamente.";
    cancelEditProduct();
    loadProducts();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadProducts() {
  const { data, error } = await sb
    .from(TABLE_PRODUCTS)
    .select("*")
    .order("created_at", { ascending: false });
  const tbody = document.getElementById("productsTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Error cargando productos: ${error.message}</td></tr>`;
    return;
  }
  tbody._rows = data;
  data.forEach((p) => {
    const url = imageUrl(p.image_path);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${url ? `<img src="${url}" alt="">` : ""}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category)}</td>
      <td>${escapeHtml(p.price_label || "")}</td>
      <td>${p.is_active ? "Sí" : "No"}</td>
      <td class="row-actions">
        <button class="btn btn-edit" data-edit-product="${p.id}">Editar</button>
        <button class="btn btn-danger" data-delete-product="${p.id}" data-path="${p.image_path || ""}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("productsTableBody").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-product]");
  if (editBtn) {
    const row = document.getElementById("productsTableBody")._rows.find(
      (r) => String(r.id) === editBtn.dataset.editProduct
    );
    if (row) startEditProduct(row);
    return;
  }
  const btn = e.target.closest("[data-delete-product]");
  if (!btn) return;
  if (!confirm("¿Borrar este producto?")) return;
  const id = btn.dataset.deleteProduct;
  const path = btn.dataset.path;
  if (path) await sb.storage.from(STORAGE_BUCKET).remove([path]);
  await sb.from(TABLE_PRODUCTS).delete().eq("id", id);
  loadProducts();
});

// ---------------------------------------------------------------
// GALERÍA: fotos (subidas o por Drive) y videos + punto focal +
// submit (múltiples archivos, o edición de una sola) + listado
// ---------------------------------------------------------------
const GALLERY_ASPECT = { taller: "1/1", prensa: "16/9", charlas: "16/9", clientes: "16/9" };
let galleryEntries = []; // [{ blob, picker, imagePath?, keepExisting? }] — fotos por subir, Drive o GitHub, todas juntas
let editingGalleryId = null;
let editingGalleryOriginal = null;

function currentGalleryAspect() {
  return GALLERY_ASPECT[document.getElementById("g_category").value] || "4/3";
}

function addFocalListItem(imgBlob, label, initial) {
  const list = document.getElementById("g_focal_list");
  const aspect = currentGalleryAspect();

  const item = document.createElement("div");
  item.className = "focal-list-item";
  item.innerHTML = `
    <div class="focal-picker" style="aspect-ratio:${aspect}">
      <img class="focal-picker-img" alt="">
      <div class="focal-crosshair"></div>
    </div>
    <div class="focal-info">
      <div class="file-name">${escapeHtml(label)}</div>
      <p class="hint" style="margin-top:6px">Hacé click o arrastrá el punto para elegir qué parte de la foto queda visible. Elegí el punto primero, y recién después ajustá el zoom — así el zoom se hace justo desde ahí.</p>
      <div class="focal-zoom-row">
        <label style="margin:0; font-weight:400; font-size:.82rem; flex-shrink:0">Zoom</label>
        <input type="range" class="g-focal-zoom" min="100" max="250" step="1" value="100">
        <span class="g-focal-zoom-label">100%</span>
      </div>
    </div>
  `;
  list.appendChild(item);

  const pickerImg = item.querySelector(".focal-picker-img");
  pickerImg.src = imgBlob instanceof Blob ? URL.createObjectURL(imgBlob) : imgBlob;

  const picker = setupFocalPicker(
    item.querySelector(".focal-picker"),
    item.querySelector(".focal-crosshair"),
    initial,
    () => {},
    item.querySelector(".g-focal-zoom"),
    item.querySelector(".g-focal-zoom-label")
  );
  return picker;
}

// En edición, cualquier fuente nueva (archivo, Drive o GitHub) reemplaza
// a la única foto que se está editando. Fuera de edición, se van
// agregando una tras otra a la misma lista.
function clearGalleryQueueIfEditing() {
  if (!editingGalleryId) return;
  document.getElementById("g_focal_list").innerHTML = "";
  galleryEntries = [];
}

async function handleGalleryFiles(fileList) {
  if (editingGalleryId) {
    clearGalleryQueueIfEditing();
    const file = fileList[0];
    const compressed = await compressImage(file, 1200, 0.75);
    const picker = addFocalListItem(compressed, `${file.name} (reemplazo)`, { x: 50, y: 50 });
    galleryEntries.push({ blob: compressed, picker });
    return;
  }
  for (const file of Array.from(fileList)) {
    const compressed = await compressImage(file, 1200, 0.75);
    const sizeLabel = `${file.name} — Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
    const picker = addFocalListItem(compressed, sizeLabel, { x: 50, y: 50 });
    galleryEntries.push({ blob: compressed, picker });
  }
}

document.getElementById("g_category").addEventListener("change", () => {
  const aspect = currentGalleryAspect();
  document.querySelectorAll("#g_focal_list .focal-picker").forEach((el) => {
    el.style.aspectRatio = aspect;
  });
  const showIndustria = document.getElementById("g_category").value === "charlas";
  document.getElementById("g_industria_section").style.display = showIndustria ? "block" : "none";
  if (showIndustria) loadIndustriaMedia();
});
// Estado inicial al cargar la página (por si "Charlas" ya viene seleccionada).
if (document.getElementById("g_category").value === "charlas") {
  document.getElementById("g_industria_section").style.display = "block";
  loadIndustriaMedia();
}

setupDropzone(document.getElementById("g_dropzone"), document.getElementById("g_images"), (files) =>
  handleGalleryFiles(files)
);

// Tipo: Foto vs Video
document.querySelectorAll("#g_type_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#g_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const isImage = tab.dataset.mtype === "image";
    document.getElementById("g_image_form").style.display = isImage ? "block" : "none";
    document.getElementById("g_video_form").style.display = isImage ? "none" : "block";
  });
});

// Dentro de "Foto": subir archivo(s) / link de Drive / ruta en GitHub —
// las tres alimentan la MISMA lista de abajo, se pueden combinar.
document.querySelectorAll("#g_image_source_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#g_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const source = tab.dataset.isource;
    document.getElementById("g_image_upload_block").style.display = source === "upload" ? "block" : "none";
    document.getElementById("g_image_drive_block").style.display = source === "drive" ? "block" : "none";
    document.getElementById("g_image_github_block").style.display = source === "github" ? "block" : "none";
  });
});

document.getElementById("g_image_drive_load").addEventListener("click", () => {
  const status = document.getElementById("g_status");
  const input = document.getElementById("g_image_drive_url");
  const directUrl = driveImageUrl(input.value.trim());
  if (!directUrl) {
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  clearGalleryQueueIfEditing();

  const picker = addFocalListItem(directUrl, "Foto desde Drive", { x: 50, y: 50 });
  galleryEntries.push({ blob: null, picker, imagePath: directUrl });
  input.value = "";
});

document.getElementById("g_image_github_load").addEventListener("click", () => {
  const status = document.getElementById("g_status");
  const input = document.getElementById("g_image_github_path");
  const path = normalizeStaticAssetPath(input.value);
  if (!path) {
    status.className = "status err";
    status.textContent = 'La ruta tiene que empezar con "assets/", ej: assets/prensa/foto.jpg';
    return;
  }
  status.className = "";
  status.textContent = "";
  clearGalleryQueueIfEditing();

  const picker = addFocalListItem(path, "Foto desde el repositorio", { x: 50, y: 50 });
  galleryEntries.push({ blob: null, picker, imagePath: path });
  input.value = "";
});

function resetGalleryTypeAndSource() {
  document.querySelectorAll("#g_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#g_type_tabs .tab[data-mtype="image"]').classList.add("is-active");
  document.getElementById("g_image_form").style.display = "block";
  document.getElementById("g_video_form").style.display = "none";

  document.querySelectorAll("#g_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#g_image_source_tabs .tab[data-isource="upload"]').classList.add("is-active");
  document.getElementById("g_image_upload_block").style.display = "block";
  document.getElementById("g_image_drive_block").style.display = "none";
  document.getElementById("g_image_github_block").style.display = "none";

  document.getElementById("g_image_drive_url").value = "";
  document.getElementById("g_image_github_path").value = "";
  document.getElementById("g_video_url").value = "";
}

function startEditGallery(g) {
  editingGalleryId = g.id;
  editingGalleryOriginal = g;
  galleryEntries = [];
  resetGalleryTypeAndSource();

  document.getElementById("g_category").value = g.category;
  document.getElementById("g_title").value = g.title || "";
  document.getElementById("g_alt").value = g.alt_text || "";
  document.getElementById("g_date").value = g.event_date || "";

  document.getElementById("g_focal_list").innerHTML = "";

  if (g.media_type === "video") {
    document.querySelectorAll("#g_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    document.querySelector('#g_type_tabs .tab[data-mtype="video"]').classList.add("is-active");
    document.getElementById("g_image_form").style.display = "none";
    document.getElementById("g_video_form").style.display = "block";
    document.getElementById("g_video_url").value = g.video_url || "";
  } else {
    const picker = addFocalListItem(imageUrl(g.image_path), "Foto actual — soltá una nueva arriba para reemplazarla", {
      x: g.focal_x ?? 50,
      y: g.focal_y ?? 50,
      zoom: g.zoom ?? 100,
    });
    // Referencia "vacía": si no se suelta una foto nueva, se reusa la imagen actual (sin blob).
    galleryEntries.push({ file: null, blob: null, picker, keepExisting: true });
  }

  document.getElementById("g_form_title").textContent = `Editando: ${g.title || "sin título"}`;
  document.getElementById("g_cancel_edit").style.display = "inline-block";
  document.getElementById("g_submit").textContent = "Guardar cambios";
  document.getElementById("panel-galeria").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditGallery() {
  editingGalleryId = null;
  editingGalleryOriginal = null;
  galleryEntries = [];
  document.getElementById("galleryForm").reset();
  document.getElementById("g_focal_list").innerHTML = "";
  resetGalleryTypeAndSource();
  document.getElementById("g_form_title").textContent = "Nueva(s) foto(s) de galería";
  document.getElementById("g_cancel_edit").style.display = "none";
  document.getElementById("g_submit").textContent = "Subir foto(s)";
}
document.getElementById("g_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditGallery();
});

document.getElementById("galleryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("g_status");
  const submitBtn = document.getElementById("g_submit");
  const category = document.getElementById("g_category").value;
  const isEditing = !!editingGalleryId;
  const isVideoTab = document
    .querySelector('#g_type_tabs .tab[data-mtype="video"]')
    .classList.contains("is-active");

  const commonFields = {
    category,
    title: document.getElementById("g_title").value.trim() || null,
    alt_text: document.getElementById("g_alt").value.trim() || null,
    event_date: document.getElementById("g_date").value || null,
  };

  function oldPathIsOwnFile(path) {
    return isOwnStorageFile(path);
  }

  try {
    submitBtn.disabled = true;
    status.className = "status busy";

    // ---------- VIDEO ----------
    if (isVideoTab) {
      const videoUrl = document.getElementById("g_video_url").value.trim();
      if (!videoUrl) {
        status.className = "status err";
        status.textContent = "Pegá el link del video.";
        return;
      }
      const payload = { ...commonFields, media_type: "video", video_url: videoUrl, image_path: null, focal_x: 50, focal_y: 50 };

      if (isEditing) {
        status.textContent = "Guardando cambios…";
        if (oldPathIsOwnFile(editingGalleryOriginal.image_path)) {
          await sb.storage.from(STORAGE_BUCKET).remove([editingGalleryOriginal.image_path]);
        }
        const { error } = await sb.from(TABLE_GALLERY).update(payload).eq("id", editingGalleryId);
        if (error) throw error;
        status.className = "status ok";
        status.textContent = "Actualizado correctamente.";
        cancelEditGallery();
      } else {
        status.textContent = "Guardando video…";
        const { error } = await sb.from(TABLE_GALLERY).insert(payload);
        if (error) throw error;
        status.className = "status ok";
        status.textContent = "Video cargado correctamente.";
        e.target.reset();
        resetGalleryTypeAndSource();
      }
      loadGallery(category);
      return;
    }

    // ---------- FOTO(S) — subidas, por Drive o por GitHub, todas juntas ----------
    if (!galleryEntries.length) {
      status.className = "status err";
      status.textContent = "Elegí o agregá al menos una foto.";
      return;
    }

    if (isEditing) {
      status.textContent = "Guardando cambios…";
      const entry = galleryEntries[0];
      let imagePath = editingGalleryOriginal.image_path;
      const focal = entry.picker.get();

      if (entry.imagePath) {
        // Reemplazo por Drive o GitHub: ya es una URL/ruta final.
        imagePath = entry.imagePath;
        if (oldPathIsOwnFile(editingGalleryOriginal.image_path)) {
          await sb.storage.from(STORAGE_BUCKET).remove([editingGalleryOriginal.image_path]);
        }
      } else if (!entry.keepExisting || entry.blob) {
        imagePath = await uploadToStorage(entry.blob, category);
        if (oldPathIsOwnFile(editingGalleryOriginal.image_path)) {
          await sb.storage.from(STORAGE_BUCKET).remove([editingGalleryOriginal.image_path]);
        }
      }

      const { error } = await sb
        .from(TABLE_GALLERY)
        .update({ ...commonFields, media_type: "image", image_path: imagePath, video_url: null, focal_x: focal.x, focal_y: focal.y, zoom: focal.zoom })
        .eq("id", editingGalleryId);
      if (error) throw error;

      status.className = "status ok";
      status.textContent = "Foto actualizada correctamente.";
      cancelEditGallery();
      loadGallery(category);
      return;
    }

    let count = 0;
    for (const entry of galleryEntries) {
      count++;
      status.textContent = `Guardando ${count} de ${galleryEntries.length}…`;

      const imagePath = entry.imagePath || (await uploadToStorage(entry.blob, category));
      const focal = entry.picker.get();

      const { error } = await sb.from(TABLE_GALLERY).insert({
        ...commonFields,
        media_type: "image",
        image_path: imagePath,
        video_url: null,
        focal_x: focal.x,
        focal_y: focal.y,
        zoom: focal.zoom,
      });
      if (error) throw error;
    }

    status.className = "status ok";
    status.textContent = `${count} foto(s) cargada(s) correctamente.`;
    e.target.reset();
    document.getElementById("g_focal_list").innerHTML = "";
    galleryEntries = [];
    resetGalleryTypeAndSource();
    loadGallery(category);
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

document.querySelectorAll("#galleryFilterTabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#galleryFilterTabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    loadGallery(tab.dataset.gcat);
  });
});

async function loadGallery(category) {
  const { data, error } = await sb
    .from(TABLE_GALLERY)
    .select("*")
    .eq("category", category)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  const tbody = document.getElementById("galleryTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error cargando galería: ${error.message}</td></tr>`;
    return;
  }
  tbody._rows = data;
  data.forEach((g, i) => {
    const thumb =
      g.media_type === "video"
        ? (() => {
            const vThumb = driveThumbnail(g.video_url) || youtubeThumbnail(g.video_url);
            return vThumb
              ? `<div class="media-video-thumb" style="width:44px;height:44px"><img src="${vThumb}" alt=""></div>`
              : `<div class="media-video-thumb" style="width:44px;height:44px">🎬</div>`;
          })()
        : (() => {
            const url = imageUrl(g.image_path);
            return url ? `<img src="${url}" alt="">` : "";
          })();
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${thumb}</td>
      <td>${escapeHtml(g.title || "—")}</td>
      <td>${escapeHtml(g.event_date || "")}</td>
      <td class="row-actions">
        <button class="btn btn-ghost btn-small" data-move-gallery="${g.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-small" data-move-gallery="${g.id}" data-dir="down" ${i === data.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn-edit" data-edit-gallery="${g.id}">Editar</button>
        <button class="btn btn-danger" data-delete-gallery="${g.id}" data-path="${g.image_path || ""}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("galleryTableBody").addEventListener("click", async (e) => {
  const rows = document.getElementById("galleryTableBody")._rows;

  const moveBtn = e.target.closest("[data-move-gallery]");
  if (moveBtn) {
    const activeCat = document.querySelector("#galleryFilterTabs .tab.is-active").dataset.gcat;
    await reorderList(TABLE_GALLERY, rows, Number(moveBtn.dataset.moveGallery), moveBtn.dataset.dir, () =>
      loadGallery(activeCat)
    );
    return;
  }

  const editBtn = e.target.closest("[data-edit-gallery]");
  if (editBtn) {
    const row = rows.find((r) => String(r.id) === editBtn.dataset.editGallery);
    if (row) startEditGallery(row);
    return;
  }
  const btn = e.target.closest("[data-delete-gallery]");
  if (!btn) return;
  if (!confirm("¿Borrar esta foto?")) return;
  const id = btn.dataset.deleteGallery;
  const path = btn.dataset.path;
  if (isOwnStorageFile(path)) await sb.storage.from(STORAGE_BUCKET).remove([path]);
  await sb.from(TABLE_GALLERY).delete().eq("id", id);
  const activeCat = document.querySelector("#galleryFilterTabs .tab.is-active").dataset.gcat;
  loadGallery(activeCat);
});

// ---------------------------------------------------------------
// CONFIGURACIÓN DEL SITIO (contacto, bio, fotos)
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// FOTOS Y VIDEOS DE "IMPRESIÓN 3D EN LA INDUSTRIA"
// Varias por tarjeta, en su propia tabla (rabbit3d_industria_media) —
// mismo patrón que el gestor de fotos/videos de categorías.
// ---------------------------------------------------------------
const TABLE_INDUSTRIA_MEDIA = "rabbit3d_industria_media";
const INDUSTRIA_KEYS = ["alimentos", "construccion", "medicina", "manufactura"];
let activeIndustriaCardKey = "alimentos";
let industriaMediaFocalPicker = null;
let industriaMediaDriveUrl = null;

document.querySelectorAll("#im_card_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#im_card_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    activeIndustriaCardKey = tab.dataset.cardkey;
    resetIndustriaMediaForm();
    loadIndustriaMedia();
  });
});

document.querySelectorAll("#im_type_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#im_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const isImage = tab.dataset.mtype === "image";
    document.getElementById("im_image_form").style.display = isImage ? "block" : "none";
    document.getElementById("im_video_form").style.display = isImage ? "none" : "block";
  });
});

document.querySelectorAll("#im_image_source_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#im_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const source = tab.dataset.isource;
    document.getElementById("im_image_upload_block").style.display = source === "upload" ? "block" : "none";
    document.getElementById("im_image_drive_block").style.display = source === "drive" ? "block" : "none";
    document.getElementById("im_image_github_block").style.display = source === "github" ? "block" : "none";
  });
});

function resetIndustriaMediaForm() {
  document.getElementById("im_image").value = "";
  document.getElementById("im_image")._compressedBlob = null;
  document.getElementById("im_image_drive_url").value = "";
  document.getElementById("im_image_github_path").value = "";
  document.getElementById("im_focal_wrap").style.display = "none";
  document.getElementById("im_video_url").value = "";
  document.getElementById("im_caption").value = "";
  industriaMediaFocalPicker = null;
  industriaMediaDriveUrl = null;
  document.querySelectorAll("#im_type_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#im_type_tabs .tab[data-mtype="image"]').classList.add("is-active");
  document.getElementById("im_image_form").style.display = "block";
  document.getElementById("im_video_form").style.display = "none";
  document.querySelectorAll("#im_image_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
  document.querySelector('#im_image_source_tabs .tab[data-isource="upload"]').classList.add("is-active");
  document.getElementById("im_image_upload_block").style.display = "block";
  document.getElementById("im_image_drive_block").style.display = "none";
  document.getElementById("im_image_github_block").style.display = "none";
}

async function handleIndustriaMediaFile(file) {
  const focalWrap = document.getElementById("im_focal_wrap");
  const img = document.getElementById("im_preview_img");
  const label = document.getElementById("im_preview_label");
  label.textContent = "Comprimiendo…";
  focalWrap.style.display = "flex";

  const compressed = await compressImage(file, 1200, 0.75);
  img.src = URL.createObjectURL(compressed);
  label.textContent = `Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
  document.getElementById("im_image")._compressedBlob = compressed;

  industriaMediaFocalPicker = setupFocalPicker(
    document.getElementById("im_focal_picker"),
    document.getElementById("im_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("im_focal_zoom"),
    document.getElementById("im_focal_zoom_label")
  );
}
setupDropzone(document.getElementById("im_dropzone"), document.getElementById("im_image"), (files) =>
  handleIndustriaMediaFile(files[0])
);

document.getElementById("im_image_drive_load").addEventListener("click", () => {
  const status = document.getElementById("im_status");
  const directUrl = driveImageUrl(document.getElementById("im_image_drive_url").value.trim());
  if (!directUrl) {
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  industriaMediaDriveUrl = directUrl;

  const focalWrap = document.getElementById("im_focal_wrap");
  const img = document.getElementById("im_preview_img");
  const label = document.getElementById("im_preview_label");
  img.src = directUrl;
  label.textContent = "Vista previa desde Drive";
  focalWrap.style.display = "flex";

  industriaMediaFocalPicker = setupFocalPicker(
    document.getElementById("im_focal_picker"),
    document.getElementById("im_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("im_focal_zoom"),
    document.getElementById("im_focal_zoom_label")
  );
});

document.getElementById("im_image_github_load").addEventListener("click", () => {
  const status = document.getElementById("im_status");
  const path = normalizeStaticAssetPath(document.getElementById("im_image_github_path").value);
  if (!path) {
    status.className = "status err";
    status.textContent = 'La ruta tiene que empezar con "assets/", ej: assets/industria/foto.jpg';
    return;
  }
  status.className = "";
  status.textContent = "";
  industriaMediaDriveUrl = path;

  const focalWrap = document.getElementById("im_focal_wrap");
  const img = document.getElementById("im_preview_img");
  const label = document.getElementById("im_preview_label");
  img.src = path;
  label.textContent = "Vista previa desde el repositorio";
  focalWrap.style.display = "flex";

  industriaMediaFocalPicker = setupFocalPicker(
    document.getElementById("im_focal_picker"),
    document.getElementById("im_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("im_focal_zoom"),
    document.getElementById("im_focal_zoom_label")
  );
});

document.getElementById("im_submit").addEventListener("click", async () => {
  const status = document.getElementById("im_status");
  const isImageTab = document.querySelector('#im_type_tabs .tab[data-mtype="image"]').classList.contains("is-active");
  const caption = document.getElementById("im_caption").value.trim() || null;

  try {
    status.className = "status busy";

    if (isImageTab) {
      const isDriveSource = document.querySelector("#im_image_source_tabs .tab.is-active")?.dataset.isource !== "upload";
      let imagePath;
      let focal = industriaMediaFocalPicker ? industriaMediaFocalPicker.get() : { x: 50, y: 50 };

      if (isDriveSource) {
        if (!industriaMediaDriveUrl) {
          status.className = "status err";
          status.textContent = "Cargá la vista previa primero (Drive o GitHub).";
          return;
        }
        imagePath = industriaMediaDriveUrl;
      } else {
        const fileInput = document.getElementById("im_image");
        const file = fileInput.files[0];
        if (!file) {
          status.className = "status err";
          status.textContent = "Elegí una foto primero.";
          return;
        }
        status.textContent = "Subiendo foto…";
        const blob = fileInput._compressedBlob || (await compressImage(file, 1200, 0.75));
        imagePath = await uploadToStorage(blob, "industria");
      }

      const { error } = await sb.from(TABLE_INDUSTRIA_MEDIA).insert({
        card_key: activeIndustriaCardKey,
        media_type: "image",
        image_path: imagePath,
        focal_x: focal.x,
        focal_y: focal.y,
        zoom: focal.zoom,
        caption,
      });
      if (error) throw error;
    } else {
      const videoUrl = document.getElementById("im_video_url").value.trim();
      if (!videoUrl) {
        status.className = "status err";
        status.textContent = "Pegá el link del video.";
        return;
      }
      status.textContent = "Guardando video…";
      const { error } = await sb.from(TABLE_INDUSTRIA_MEDIA).insert({
        card_key: activeIndustriaCardKey,
        media_type: "video",
        video_url: videoUrl,
        caption,
      });
      if (error) throw error;
    }

    status.className = "status ok";
    status.textContent = "Agregado correctamente.";
    resetIndustriaMediaForm();
    loadIndustriaMedia();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  }
});

async function loadIndustriaMedia() {
  const { data, error } = await sb
    .from(TABLE_INDUSTRIA_MEDIA)
    .select("*")
    .eq("card_key", activeIndustriaCardKey)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  const list = document.getElementById("im_media_list");
  list.innerHTML = "";
  if (error) {
    list.innerHTML = `<p class="hint">Error cargando: ${error.message}</p>`;
    return;
  }
  list._rows = data;
  if (!data.length) {
    list.innerHTML = `<p class="hint">Todavía no cargaste nada para esta tarjeta.</p>`;
    return;
  }
  data.forEach((m, i) => {
    const div = document.createElement("div");
    const moveBtns = `
      <div class="row-actions" style="margin-top:8px">
        <button class="btn btn-ghost btn-small" data-move-imedia="${m.id}" data-dir="up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost btn-small" data-move-imedia="${m.id}" data-dir="down" ${i === data.length - 1 ? "disabled" : ""}>↓</button>
      </div>`;
    if (m.media_type === "image") {
      div.className = "focal-list-item";
      div.innerHTML = `
        <div class="focal-picker" style="aspect-ratio:4/3; max-width:140px; cursor:default">
          <img class="focal-picker-img" src="${imageUrl(m.image_path)}" alt="" style="object-position:${m.focal_x}% ${m.focal_y}%">
        </div>
        <div class="focal-info">
          <div class="file-name">${escapeHtml(m.caption || "Foto")}</div>
          <button class="btn btn-danger" data-delete-imedia="${m.id}" data-path="${m.image_path}">Borrar</button>
          ${moveBtns}
        </div>`;
    } else {
      const thumb = driveThumbnail(m.video_url) || youtubeThumbnail(m.video_url);
      div.className = "media-video-item";
      div.innerHTML = `
        <div class="media-video-thumb">${thumb ? `<img src="${thumb}" alt="">` : "🎬"}</div>
        <div class="media-video-info">
          <div class="file-name">${escapeHtml(m.caption || "Video")}</div>
          <a href="${m.video_url}" target="_blank" rel="noopener">${escapeHtml(m.video_url)}</a>
          ${moveBtns}
        </div>
        <button class="btn btn-danger" data-delete-imedia="${m.id}">Borrar</button>`;
    }
    list.appendChild(div);
  });
}

document.getElementById("im_media_list").addEventListener("click", async (e) => {
  const moveBtn = e.target.closest("[data-move-imedia]");
  if (moveBtn) {
    const rows = document.getElementById("im_media_list")._rows;
    await reorderList(TABLE_INDUSTRIA_MEDIA, rows, Number(moveBtn.dataset.moveImedia), moveBtn.dataset.dir, loadIndustriaMedia);
    return;
  }
  const btn = e.target.closest("[data-delete-imedia]");
  if (!btn) return;
  if (!confirm("¿Borrar este elemento?")) return;
  const path = btn.dataset.path;
  if (isOwnStorageFile(path)) await sb.storage.from(STORAGE_BUCKET).remove([path]);
  await sb.from(TABLE_INDUSTRIA_MEDIA).delete().eq("id", btn.dataset.deleteImedia);
  loadIndustriaMedia();
});

let profilePhotoPicker = null;
let profilePhotoNewBlob = null; // solo se llena si se soltó una foto nueva (subida)
let profilePhotoNewPath = null; // solo se llena si se cargó por Drive o GitHub

async function loadSettings() {
  const { data, error } = await sb.from(TABLE_SETTINGS).select("*").eq("id", 1).maybeSingle();
  if (error || !data) return;
  document.getElementById("s_whatsapp").value = data.whatsapp_number || "";
  document.getElementById("s_instagram").value = data.instagram_handle || "";
  document.getElementById("s_email").value = data.contact_email || "";
  document.getElementById("s_zone").value = data.zone_text || "";
  document.getElementById("s_cults3d").value = data.cults3d_url || "";
  document.getElementById("s_telegram").value = data.telegram_url || "";
  document.getElementById("s_show_clientes").checked = !!data.show_clientes;

  // Mostrar la foto YA cargada (antes esto quedaba invisible y parecía que no había nada).
  if (data.profile_photo_path) {
    const wrap = document.getElementById("s_photo_focal_wrap");
    const img = document.getElementById("s_photo_preview_img");
    const label = document.getElementById("s_photo_preview_label");
    img.src = imageUrl(data.profile_photo_path);
    label.textContent = "Foto actual";
    wrap.style.display = "flex";
    profilePhotoPicker = setupFocalPicker(
    document.getElementById("s_photo_focal_picker"),
    document.getElementById("s_photo_focal_crosshair"),
    { x: data.profile_photo_focal_x ?? 50, y: data.profile_photo_focal_y ?? 50, zoom: data.profile_photo_zoom ?? 100},
    () => {},
    document.getElementById("s_photo_focal_zoom"),
    document.getElementById("s_photo_focal_zoom_label")
  );
  }
}

async function handleProfilePhotoFile(file) {
  const wrap = document.getElementById("s_photo_focal_wrap");
  const img = document.getElementById("s_photo_preview_img");
  const label = document.getElementById("s_photo_preview_label");
  label.textContent = "Comprimiendo…";
  wrap.style.display = "flex";

  const compressed = await compressImage(file, 1000, 0.78);
  img.src = URL.createObjectURL(compressed);
  label.textContent = `Nueva foto — Original ${kb(file.size)} → optimizada ${kb(compressed.size)}`;
  profilePhotoNewBlob = compressed;
  profilePhotoNewPath = null;

  profilePhotoPicker = setupFocalPicker(
    document.getElementById("s_photo_focal_picker"),
    document.getElementById("s_photo_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("s_photo_focal_zoom"),
    document.getElementById("s_photo_focal_zoom_label")
  );
}

setupDropzone(document.getElementById("s_photo_dropzone"), document.getElementById("s_profile_photo"), (files) =>
  handleProfilePhotoFile(files[0])
);

// Fuente de la foto: Subir archivo / Link de Drive / Ruta en GitHub
document.querySelectorAll("#s_photo_source_tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#s_photo_source_tabs .tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const source = tab.dataset.isource;
    document.getElementById("s_photo_upload_block").style.display = source === "upload" ? "block" : "none";
    document.getElementById("s_photo_drive_block").style.display = source === "drive" ? "block" : "none";
    document.getElementById("s_photo_github_block").style.display = source === "github" ? "block" : "none";
  });
});

function loadProfilePhotoPreview(url, label) {
  const wrap = document.getElementById("s_photo_focal_wrap");
  const img = document.getElementById("s_photo_preview_img");
  const labelEl = document.getElementById("s_photo_preview_label");
  img.src = url;
  labelEl.textContent = label;
  wrap.style.display = "flex";
  profilePhotoNewBlob = null;
  profilePhotoNewPath = url;
  profilePhotoPicker = setupFocalPicker(
    document.getElementById("s_photo_focal_picker"),
    document.getElementById("s_photo_focal_crosshair"),
    { x: 50, y: 50, zoom: 100},
    () => {},
    document.getElementById("s_photo_focal_zoom"),
    document.getElementById("s_photo_focal_zoom_label")
  );
}

document.getElementById("s_photo_drive_load").addEventListener("click", () => {
  const status = document.getElementById("s_status");
  const directUrl = driveImageUrl(document.getElementById("s_photo_drive_url").value.trim());
  if (!directUrl) {
    status.className = "status err";
    status.textContent = "No pude leer ese link de Drive. Verificá que sea un link para compartir un archivo.";
    return;
  }
  status.className = "";
  status.textContent = "";
  loadProfilePhotoPreview(directUrl, "Vista previa desde Drive");
});

document.getElementById("s_photo_github_load").addEventListener("click", () => {
  const status = document.getElementById("s_status");
  const path = normalizeStaticAssetPath(document.getElementById("s_photo_github_path").value);
  if (!path) {
    status.className = "status err";
    status.textContent = 'La ruta tiene que empezar con "assets/", ej: assets/sobre-mi.jpg';
    return;
  }
  status.className = "";
  status.textContent = "";
  loadProfilePhotoPreview(path, "Vista previa desde el repositorio");
});

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("s_status");
  const submitBtn = document.getElementById("s_submit");

  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const update = {
      id: 1,
      whatsapp_number: document.getElementById("s_whatsapp").value.replace(/\D/g, "") || null,
      instagram_handle: document.getElementById("s_instagram").value.trim().replace(/^@/, "") || null,
      contact_email: document.getElementById("s_email").value.trim() || null,
      zone_text: document.getElementById("s_zone").value.trim() || null,
      cults3d_url: document.getElementById("s_cults3d").value.trim() || null,
      telegram_url: document.getElementById("s_telegram").value.trim() || null,
      show_clientes: document.getElementById("s_show_clientes").checked,
    };

    if (profilePhotoNewBlob) {
      status.textContent = "Subiendo foto de 'Sobre mí'…";
      update.profile_photo_path = await uploadToStorage(profilePhotoNewBlob, "sitio");
    } else if (profilePhotoNewPath) {
      update.profile_photo_path = profilePhotoNewPath;
    }
    if (profilePhotoPicker) {
      const focal = profilePhotoPicker.get();
      update.profile_photo_focal_x = focal.x;
      update.profile_photo_focal_y = focal.y;
      update.profile_photo_zoom = focal.zoom;
    }

    status.textContent = "Guardando cambios…";
    const { error } = await sb.from(TABLE_SETTINGS).upsert(update, { onConflict: "id" });
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Cambios guardados correctamente.";
    document.getElementById("s_profile_photo").value = "";
    profilePhotoNewBlob = null;
    profilePhotoNewPath = null;
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// EMPLEADOS (códigos de 4 dígitos para "ventas.html")
// ---------------------------------------------------------------
const TABLE_EMPLOYEES = "rabbit3d_employees";
let editingEmployeeId = null;
let employeesCache = [];

function cancelEditEmployee() {
  editingEmployeeId = null;
  document.getElementById("employeeForm").reset();
  document.getElementById("emp_active").checked = true;
  document.getElementById("emp_is_admin").checked = false;
  document.getElementById("emp_form_title").textContent = "Nuevo empleado";
  document.getElementById("emp_cancel_edit").style.display = "none";
  document.getElementById("emp_submit").textContent = "Guardar empleado";
}
document.getElementById("emp_cancel_edit").addEventListener("click", (e) => {
  e.preventDefault();
  cancelEditEmployee();
});

function startEditEmployee(row) {
  editingEmployeeId = row.id;
  document.getElementById("emp_name").value = row.name;
  document.getElementById("emp_pin").value = row.pin_code;
  document.getElementById("emp_active").checked = !!row.active;
  document.getElementById("emp_is_admin").checked = !!row.is_admin;
  document.getElementById("emp_form_title").textContent = "Editando empleado";
  document.getElementById("emp_cancel_edit").style.display = "inline-block";
  document.getElementById("emp_submit").textContent = "Guardar cambios";
  document.getElementById("panel-empleados").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("employeeForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("emp_status");
  const submitBtn = document.getElementById("emp_submit");
  const pin = document.getElementById("emp_pin").value.trim();

  if (!/^[0-9]{4}$/.test(pin)) {
    status.className = "status err";
    status.textContent = "El código tiene que ser de 4 números (ej: 4821).";
    return;
  }

  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const payload = {
      name: document.getElementById("emp_name").value.trim(),
      pin_code: pin,
      active: document.getElementById("emp_active").checked,
      is_admin: document.getElementById("emp_is_admin").checked,
    };

    const { error } = editingEmployeeId
      ? await sb.from(TABLE_EMPLOYEES).update(payload).eq("id", editingEmployeeId)
      : await sb.from(TABLE_EMPLOYEES).insert(payload);
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    cancelEditEmployee();
    loadEmployees();
  } catch (err) {
    status.className = "status err";
    status.textContent = err.message.includes("duplicate")
      ? "Ese código ya lo está usando otro empleado — elegí uno distinto."
      : "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadEmployees() {
  const { data, error } = await sb.from(TABLE_EMPLOYEES).select("*").order("id", { ascending: true });
  const tbody = document.getElementById("employeesTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5">Error cargando: ${error.message}</td></tr>`;
    return;
  }
  employeesCache = data;
  data.forEach((emp) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(emp.name)}</td>
      <td style="font-family:var(--font-mono)">${escapeHtml(emp.pin_code)}</td>
      <td>${emp.active ? "Sí" : "No"}</td>
      <td>${emp.is_admin ? "Sí" : "No"}</td>
      <td class="row-actions">
        <button class="btn btn-edit" data-edit-employee="${emp.id}">Editar</button>
        <button class="btn btn-danger" data-delete-employee="${emp.id}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("employeesTableBody").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-employee]");
  if (editBtn) {
    const row = employeesCache.find((r) => String(r.id) === editBtn.dataset.editEmployee);
    if (row) startEditEmployee(row);
    return;
  }
  const delBtn = e.target.closest("[data-delete-employee]");
  if (delBtn) {
    if (!confirm("¿Borrar este empleado? Sus reposiciones ya cargadas quedan igual, con su nombre guardado.")) return;
    await sb.from(TABLE_EMPLOYEES).delete().eq("id", delBtn.dataset.deleteEmployee);
    loadEmployees();
  }
});

// ---------------------------------------------------------------
// VENTAS DE CULTS3D POR PAÍS (para el mapa en el sitio)
// ---------------------------------------------------------------
const TABLE_CULTS_SALES = "rabbit3d_cults_sales";
let cultsSalesCache = [];

document.getElementById("cultsSaleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("cs_status");
  const submitBtn = document.getElementById("cs_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const payload = {
      country_name: document.getElementById("cs_country_name").value.trim(),
      country_code: document.getElementById("cs_country_code").value.trim().toUpperCase(),
      sales_count: Number(document.getElementById("cs_sales_count").value) || 0,
    };

    // "upsert" por código de país: si ya existe, actualiza el número en vez de duplicarlo.
    const { error } = await sb.from(TABLE_CULTS_SALES).upsert(payload, { onConflict: "country_code" });
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    document.getElementById("cultsSaleForm").reset();
    loadCultsSales();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

async function loadCultsSales() {
  const { data, error } = await sb.from(TABLE_CULTS_SALES).select("*").order("sales_count", { ascending: false });
  const tbody = document.getElementById("cultsSalesTableBody");
  tbody.innerHTML = "";
  if (error) {
    tbody.innerHTML = `<tr><td colspan="4">Error cargando: ${error.message}</td></tr>`;
    return;
  }
  cultsSalesCache = data;
  data.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(row.country_name)}</td>
      <td style="font-family:var(--font-mono)">${escapeHtml(row.country_code)}</td>
      <td>${row.sales_count}</td>
      <td class="row-actions">
        <button class="btn btn-edit" data-edit-cults-sale="${row.id}">Editar</button>
        <button class="btn btn-danger" data-delete-cults-sale="${row.id}">Borrar</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById("cultsSalesTableBody").addEventListener("click", async (e) => {
  const editBtn = e.target.closest("[data-edit-cults-sale]");
  if (editBtn) {
    const row = cultsSalesCache.find((r) => String(r.id) === editBtn.dataset.editCultsSale);
    if (row) {
      document.getElementById("cs_country_name").value = row.country_name;
      document.getElementById("cs_country_code").value = row.country_code;
      document.getElementById("cs_sales_count").value = row.sales_count;
      document.getElementById("panel-sitio").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    return;
  }
  const delBtn = e.target.closest("[data-delete-cults-sale]");
  if (delBtn) {
    if (!confirm("¿Borrar este país de la lista?")) return;
    await sb.from(TABLE_CULTS_SALES).delete().eq("id", delBtn.dataset.deleteCultsSale);
    loadCultsSales();
  }
});

// ---------------------------------------------------------------
// ÚLTIMA VENTA DE CULTS3D CARGADA (bookmark para no repetir/saltear)
// ---------------------------------------------------------------
const TABLE_CULTS_LAST_ORDER = "rabbit3d_cults_last_order";

async function loadCultsLastOrder() {
  const { data, error } = await sb.from(TABLE_CULTS_LAST_ORDER).select("*").eq("id", 1).maybeSingle();
  const current = document.getElementById("clo_current");
  if (error || !data || !data.order_id) {
    current.textContent = "Todavía no guardaste ninguna.";
    return;
  }
  current.innerHTML = `Última guardada: <strong>#${escapeHtml(data.order_id)}</strong>${data.order_date ? ` — ${escapeHtml(data.order_date)}` : ""}${data.notes ? `<br><span style="font-family:var(--font-body); color:var(--ink-soft); font-size:.85rem">${escapeHtml(data.notes)}</span>` : ""}`;
  document.getElementById("clo_order_id").value = data.order_id || "";
  document.getElementById("clo_order_date").value = data.order_date || "";
  document.getElementById("clo_notes").value = data.notes || "";
}

document.getElementById("cultsLastOrderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("clo_status");
  const submitBtn = document.getElementById("clo_submit");
  try {
    submitBtn.disabled = true;
    status.className = "status busy";
    status.textContent = "Guardando…";

    const payload = {
      id: 1,
      order_id: document.getElementById("clo_order_id").value.trim() || null,
      order_date: document.getElementById("clo_order_date").value || null,
      notes: document.getElementById("clo_notes").value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from(TABLE_CULTS_LAST_ORDER).upsert(payload, { onConflict: "id" });
    if (error) throw error;

    status.className = "status ok";
    status.textContent = "Guardado correctamente.";
    loadCultsLastOrder();
  } catch (err) {
    status.className = "status err";
    status.textContent = "Error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
});

function imageUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path; // ya es una URL completa (ej: link de Drive)
  // archivo estático del repo (GitHub Pages): la ruta "assets/..." es
  // relativa a la raíz del repo, pero admin.html vive una carpeta más
  // adentro (admin/admin.html), así que hay que subir un nivel para
  // que la vista previa cargue bien acá (en el sitio público sí es
  // relativa a la raíz, porque index.html vive en la raíz).
  if (isStaticAssetPath(path)) return `../${path}`;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}
