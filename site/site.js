import { SUPABASE_URL as SHARED_SUPABASE_URL, SUPABASE_ANON_KEY as SHARED_SUPABASE_ANON_KEY, STORAGE_BUCKET as SHARED_STORAGE_BUCKET } from "../shared/js/supabase-config.js";
import { escapeHtml } from "../shared/js/dom-utils.js";
import { driveFileId, driveThumbnail } from "../shared/js/drive-utils.js";

/**
 * CONFIGURACIÓN DEL SITIO — RABBIT3D
 * ---------------------------------------------------------------
 * Completá SUPABASE_URL y SUPABASE_ANON_KEY con los datos de TU
 * proyecto de Supabase (Project Settings → API).
 *
 * La anon key es pública por diseño (viaja en el navegador de
 * cualquier visitante), por eso el acceso real se controla con
 * las políticas de Row Level Security (RLS) del archivo
 * sql/schema.sql — esa key solo puede LEER lo que las políticas
 * permiten leer.
 *
 * Como la base de datos es compartida con otros proyectos, todas
 * las tablas y el bucket de imágenes de este sitio usan el
 * prefijo "rabbit3d_" para no chocar con nada más.
 */
window.RABBIT3D_CONFIG = {
  SUPABASE_URL: SHARED_SUPABASE_URL,
  SUPABASE_ANON_KEY: SHARED_SUPABASE_ANON_KEY,

  TABLES: {
    products: "rabbit3d_products",
    gallery: "rabbit3d_gallery",
    settings: "rabbit3d_settings",
  },

  // Nombre del bucket de Supabase Storage donde subís las imágenes optimizadas.
  STORAGE_BUCKET: SHARED_STORAGE_BUCKET,

  // Ancho máximo (px) que pedimos para las imágenes de catálogo/galería.
  // Si tu plan de Supabase tiene habilitada la transformación de imágenes,
  // esto arma una URL con ?width=&quality= para servir versiones livianas.
  // Si no está disponible, se usa la imagen tal cual fue subida
  // (por eso es clave optimizarlas ANTES de subirlas — ver scripts/optimize-images.mjs).
  IMAGE_TRANSFORM: {
    enabled: false, // poné true si confirmás que tu plan soporta transformación de imágenes
    thumbWidth: 480,
    cardWidth: 800,
    quality: 70,
  },

  // Números / usuarios de contacto (también hay que actualizarlos en index.html)
  WHATSAPP_NUMBER: "5490000000000",
  INSTAGRAM_HANDLE: "rabbit3d",
};


/**
 * Capa fina sobre el cliente de Supabase.
 * Si no hay credenciales configuradas (o falla la conexión), las
 * funciones devuelven `null` y main.js usa los datos de ejemplo
 * para que la página nunca se vea rota.
 */
(function () {
  const cfg = window.RABBIT3D_CONFIG;
  let client = null;

  try {
    if (
      cfg &&
      window.supabase &&
      cfg.SUPABASE_URL &&
      !cfg.SUPABASE_URL.includes("TU-PROYECTO") &&
      cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_ANON_KEY.includes("TU-ANON-KEY")
    ) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
  } catch (err) {
    console.warn("[rabbit3d] No se pudo inicializar Supabase:", err);
  }

  /** Arma la URL pública (y opcionalmente optimizada) de un archivo del bucket. */
  function buildImageUrl(path, targetWidth) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path; // ya es una URL completa
    if (path.startsWith("assets/")) return path; // archivo estático del propio repo (GitHub Pages)

    const base = `${cfg.SUPABASE_URL}/storage/v1/object/public/${cfg.STORAGE_BUCKET}/${path}`;
    if (!cfg.IMAGE_TRANSFORM.enabled) return base;

    const renderBase = `${cfg.SUPABASE_URL}/storage/v1/render/image/public/${cfg.STORAGE_BUCKET}/${path}`;
    const w = targetWidth || cfg.IMAGE_TRANSFORM.cardWidth;
    return `${renderBase}?width=${w}&quality=${cfg.IMAGE_TRANSFORM.quality}&resize=cover`;
  }

  async function fetchProducts() {
    if (!client) return null;
    const { data, error } = await client
      .from(cfg.TABLES.products)
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo productos:", error.message);
      return null;
    }
    return data;
  }

  async function fetchGallery(category) {
    if (!client) return null;
    const { data, error } = await client
      .from(cfg.TABLES.gallery)
      .select("*")
      .eq("category", category)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn(`[rabbit3d] Error trayendo galería (${category}):`, error.message);
      return null;
    }
    return data;
  }

  async function fetchSettings() {
    if (!client) return null;
    const { data, error } = await client
      .from(cfg.TABLES.settings)
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      console.warn("[rabbit3d] Error trayendo configuración del sitio:", error.message);
      return null;
    }
    return data;
  }

  async function fetchCategories() {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo categorías:", error.message);
      return null;
    }
    return data;
  }

  async function fetchCategoryMedia(categoryId) {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_category_media")
      .select("*")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo fotos/videos de la categoría:", error.message);
      return null;
    }
    return data;
  }

  // OJO: acá se piden explícitamente solo las columnas públicas.
  // "unit_price" está bloqueado a nivel de base de datos para el rol
  // "anon" — si se pidiera con select("*"), la consulta entera fallaría.
  async function fetchCategoryPricing(categoryId) {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_category_pricing")
      .select("id, category_id, quantity, total_price, sort_order")
      .eq("category_id", categoryId)
      .order("sort_order", { ascending: true })
      .order("quantity", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo precios de la categoría:", error.message);
      return null;
    }
    return data;
  }

  // Trae los precios de TODAS las categorías en una sola consulta (en vez
  // de una por tarjeta), para poder mostrarlos directo en la grilla del
  // inicio sin golpear la base de datos una vez por cada producto.
  async function fetchAllCategoryPricing() {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_category_pricing")
      .select("id, category_id, quantity, total_price, sort_order")
      .order("sort_order", { ascending: true })
      .order("quantity", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo precios:", error.message);
      return null;
    }
    return data;
  }

  // Fotos/videos de las tarjetas de "Impresión 3D en la industria" —
  // una sola consulta trae las de las 4 tarjetas juntas.
  async function fetchAllIndustriaMedia() {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_industria_media")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo fotos/videos de industria:", error.message);
      return null;
    }
    return data;
  }

  async function fetchIndustriaMediaByKey(cardKey) {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_industria_media")
      .select("*")
      .eq("card_key", cardKey)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) {
      console.warn("[rabbit3d] Error trayendo fotos/videos de la tarjeta:", error.message);
      return null;
    }
    return data;
  }

  async function fetchCultsSales() {
    if (!client) return null;
    const { data, error } = await client
      .from("rabbit3d_cults_sales")
      .select("*")
      .order("sales_count", { ascending: false });
    if (error) {
      console.warn("[rabbit3d] Error trayendo ventas de Cults3D:", error.message);
      return null;
    }
    return data;
  }

  window.Rabbit3DData = {
    client,
    buildImageUrl,
    fetchProducts,
    fetchGallery,
    fetchSettings,
    fetchCategories,
    fetchCategoryMedia,
    fetchCategoryPricing,
    fetchAllCategoryPricing,
    fetchAllIndustriaMedia,
    fetchIndustriaMediaByKey,
    fetchCultsSales,
  };
})();


document.addEventListener("DOMContentLoaded", init);

// ---------------------------------------------------------------
// DATOS DE EJEMPLO (se usan solo si Supabase no está configurado
// todavía, o si una tabla está vacía). Reemplazá / borrá esto
// cargando tus propios datos en Supabase — ver sql/schema.sql.
// ---------------------------------------------------------------
const GALLERY_PLACEHOLDER_TEXT = {
  taller: "Sumá una foto de tu taller",
};

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  setupNavToggle();
  setupAuth();
  setupCategoryModal();
  setupWhatsappModal();
  setupIndustriaLightbox();

  // Todo esto se pide en paralelo (no uno atrás del otro), así ninguna
  // sección espera a las demás — por ejemplo, la foto de "Sobre mí" ya
  // no queda en cola detrás de las consultas de categorías/galerías.
  await Promise.all([
    safeFetchSettings().then(applySettings),
    (async () => {
      await renderCategories((await safeFetchCategories()) || []);
    })(),
    safeFetchGallery("taller").then((data) => renderGallery("taller", data || [])),
    safeFetchGallery("prensa").then((data) => renderPress("prensa", data || [])),
    safeFetchGallery("charlas").then((data) => renderPress("charlas", data || [])),
    safeFetchGallery("clientes").then((data) => renderPress("clientes", data || [])),
    setupIndustriaCardImages(),
    safeFetchCultsSales().then((data) => renderCultsSalesMap(data || [])),
  ]);
}

async function safeFetchCategories() {
  try {
    return (await window.Rabbit3DData?.fetchCategories()) || null;
  } catch {
    return null;
  }
}
async function safeFetchCategoryMedia(id) {
  try {
    return (await window.Rabbit3DData?.fetchCategoryMedia(id)) || null;
  } catch {
    return null;
  }
}
async function safeFetchCategoryPricing(id) {
  try {
    return (await window.Rabbit3DData?.fetchCategoryPricing(id)) || null;
  } catch {
    return null;
  }
}
async function safeFetchAllCategoryPricing() {
  try {
    return (await window.Rabbit3DData?.fetchAllCategoryPricing()) || null;
  } catch {
    return null;
  }
}
async function safeFetchAllIndustriaMedia() {
  try {
    return (await window.Rabbit3DData?.fetchAllIndustriaMedia()) || null;
  } catch {
    return null;
  }
}
async function safeFetchCultsSales() {
  try {
    return (await window.Rabbit3DData?.fetchCultsSales()) || null;
  } catch {
    return null;
  }
}
async function safeFetchIndustriaMediaByKey(cardKey) {
  try {
    return (await window.Rabbit3DData?.fetchIndustriaMediaByKey(cardKey)) || null;
  } catch {
    return null;
  }
}

async function safeFetchGallery(category) {
  try {
    return (await window.Rabbit3DData?.fetchGallery(category)) || null;
  } catch {
    return null;
  }
}
async function safeFetchSettings() {
  try {
    return (await window.Rabbit3DData?.fetchSettings()) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------
// CONFIGURACIÓN DEL SITIO (contacto, bio, fotos) — se pisa lo
// hardcodeado en el HTML solo si hay datos cargados en Supabase.
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// FOTOS DE LAS TARJETAS DE "IMPRESIÓN 3D EN LA INDUSTRIA"
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// MAPA DE VENTAS DE CULTS3D (por país, cargado a mano desde el panel)
// ---------------------------------------------------------------
// Nombres en español de los países que suelen aparecer en las ventas de
// Cults3D. Si aparece un país que no está en esta lista, la librería
// simplemente usa su nombre en inglés — no es un problema, solo se ve
// distinto en ese caso puntual.
const CULTS_COUNTRY_NAMES_ES = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", UY: "Uruguay", PY: "Paraguay",
  BO: "Bolivia", PE: "Perú", CO: "Colombia", VE: "Venezuela", EC: "Ecuador",
  MX: "México", US: "Estados Unidos", CA: "Canadá", ES: "España", FR: "Francia",
  DE: "Alemania", IT: "Italia", GB: "Reino Unido", PT: "Portugal", NL: "Países Bajos",
  BE: "Bélgica", PL: "Polonia", RU: "Rusia", CN: "China", JP: "Japón", IN: "India",
  AU: "Australia", NZ: "Nueva Zelanda", ZA: "Sudáfrica", EG: "Egipto", TR: "Turquía",
  IL: "Israel", SA: "Arabia Saudita", KR: "Corea del Sur", ID: "Indonesia",
  PH: "Filipinas", TH: "Tailandia", VN: "Vietnam", SE: "Suecia", NO: "Noruega",
  FI: "Finlandia", DK: "Dinamarca", AT: "Austria", CH: "Suiza", GR: "Grecia",
  IE: "Irlanda", CZ: "República Checa", RO: "Rumania", UA: "Ucrania",
  TW: "Taiwán", NI: "Nicaragua", HU: "Hungría", HR: "Croacia", HK: "Hong Kong",
  PR: "Puerto Rico", YT: "Mayotte",
};

// Ciudades principales (coordenadas reales) de los países con más
// ventas, para concentrar ahí la mayoría de los puntos — el resto de
// los países reparten sus puntos al azar por todo su territorio.
const CULTS_COUNTRY_HOTSPOTS = {
  AR: [
    { lat: -34.6037, lng: -58.3816, weight: 10 }, // Buenos Aires
    { lat: -31.4201, lng: -64.1888, weight: 3 }, // Córdoba
    { lat: -32.9468, lng: -60.6393, weight: 1.5 }, // Rosario
    { lat: -32.8908, lng: -68.8272, weight: 1 }, // Mendoza
  ],
  US: [
    { lat: 40.7128, lng: -74.006, weight: 4 }, // Nueva York
    { lat: 34.0522, lng: -118.2437, weight: 4 }, // Los Ángeles
    { lat: 41.8781, lng: -87.6298, weight: 2 }, // Chicago
    { lat: 29.7604, lng: -95.3698, weight: 2 }, // Houston
  ],
  FR: [
    { lat: 48.8566, lng: 2.3522, weight: 6 }, // París
    { lat: 45.764, lng: 4.8357, weight: 1.5 }, // Lyon
    { lat: 43.2965, lng: 5.3698, weight: 1 }, // Marsella
  ],
  DE: [
    { lat: 52.52, lng: 13.405, weight: 3 }, // Berlín
    { lat: 48.1351, lng: 11.582, weight: 2 }, // Múnich
    { lat: 53.5511, lng: 9.9937, weight: 1.5 }, // Hamburgo
  ],
  ES: [
    { lat: 40.4168, lng: -3.7038, weight: 4 }, // Madrid
    { lat: 41.3851, lng: 2.1734, weight: 3 }, // Barcelona
  ],
  CL: [{ lat: -33.4489, lng: -70.6693, weight: 6 }], // Santiago
  MX: [{ lat: 19.4326, lng: -99.1332, weight: 5 }], // Ciudad de México
  BR: [
    { lat: -23.5505, lng: -46.6333, weight: 4 }, // São Paulo
    { lat: -22.9068, lng: -43.1729, weight: 3 }, // Río de Janeiro
  ],
  GB: [{ lat: 51.5074, lng: -0.1278, weight: 5 }], // Londres
  UY: [{ lat: -34.9011, lng: -56.1645, weight: 6 }], // Montevideo
  CA: [
    { lat: 43.6532, lng: -79.3832, weight: 3 }, // Toronto
    { lat: 45.5019, lng: -73.5674, weight: 2 }, // Montreal
    { lat: 49.2827, lng: -123.1207, weight: 2 }, // Vancouver
  ],
};

// De cada punto que se dibuja, este % intenta caer cerca de una de esas
// ciudades (pesado por su población); el resto queda disperso por
// cualquier parte del país, para que se siga viendo una distribución
// general y no todo amontonado en un solo lugar.
const CULTS_HOTSPOT_PROBABILITY = 0.75;
const CULTS_GEOJSON_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

let cultsLeafletMap = null;

// Los datos de Natural Earth guardan el código de país en ISO_A2, salvo
// algunos casos (Francia, Noruega, Taiwán...) que usan "-99" o códigos
// no estándar (como "CN-TW") por tratarse de territorios especiales —
// para esos, ISO_A2_EH trae el código de 2 letras correcto.
function neIso2(props) {
  let a2 = props.ISO_A2 || "";
  if (!/^[A-Z]{2}$/i.test(a2)) a2 = props.ISO_A2_EH || a2;
  return (a2 || "").toUpperCase();
}

function cultsColorForCount(count, maxCount) {
  if (!count) return "#1A2438"; // sin ventas
  // Raíz cuadrada en vez de una escala lineal directa: como Argentina y
  // EE.UU. tienen muchísimas más ventas que el resto, una escala lineal
  // dejaba a todos los demás países (1, 2, 5 ventas) casi pegados al
  // color de "pocas ventas" — indistinguibles del de "sin ventas" a
  // simple vista, sobre todo en países chicos. Así, cualquier país con
  // ventas se nota claramente, no solo los dos que más vendieron.
  const t = Math.sqrt(Math.min(count / maxCount, 1));
  const c1 = [0x3a, 0x10, 0x20]; // pocas ventas
  const c2 = [0xe8, 0x12, 0x5c]; // muchas ventas (rosa de marca)
  const rgb = c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function pickWeightedHotspot(hotspots) {
  const total = hotspots.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * total;
  let chosen = hotspots[0];
  for (const h of hotspots) {
    if (r < h.weight) {
      chosen = h;
      break;
    }
    r -= h.weight;
  }
  // un poco de dispersión alrededor de la ciudad, para que no queden
  // todos los puntos exactamente apilados unos sobre otros
  const jitter = 0.18;
  return { lat: chosen.lat + (Math.random() - 0.5) * jitter, lng: chosen.lng + (Math.random() - 0.5) * jitter };
}

// Ray casting simple: ¿el punto [lng,lat] está dentro de este anillo?
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Descompone Polygon/MultiPolygon en sus contornos externos, cada uno
// con su recuadro — así se puede elegir uno pesado por tamaño (para que
// una islita chica no "compita" en igualdad con el territorio principal).
function cultsPolygonParts(geometry) {
  const parts = [];
  function addRing(coords) {
    const outer = coords[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    outer.forEach(([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    parts.push({ ring: outer, bbox: [minX, minY, maxX, maxY] });
  }
  if (geometry.type === "Polygon") addRing(geometry.coordinates);
  else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach(addRing);
  return parts;
}

function cultsRandomPointInGeometry(parts) {
  if (!parts.length) return null;
  const weights = parts.map((p) => (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]) || 0.0001);
  const total = weights.reduce((a, b) => a + b, 0);

  for (let attempt = 0; attempt < 60; attempt++) {
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < weights.length; idx++) {
      if (r < weights[idx]) break;
      r -= weights[idx];
    }
    const part = parts[idx] || parts[0];
    const [minX, minY, maxX, maxY] = part.bbox;
    const lng = minX + Math.random() * (maxX - minX);
    const lat = minY + Math.random() * (maxY - minY);
    if (pointInRing(lng, lat, part.ring)) return { lat, lng };
  }
  // si no se encontró nada en 60 intentos (forma muy irregular), el
  // centro del recuadro más grande sirve como respaldo razonable
  const biggest = parts.reduce((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) > (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) ? a : b);
  return { lat: (biggest.bbox[1] + biggest.bbox[3]) / 2, lng: (biggest.bbox[0] + biggest.bbox[2]) / 2 };
}

async function renderCultsSalesMap(rows) {
  const wrap = document.getElementById("cultsSalesMapWrap");
  if (!rows || !rows.length) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  renderCultsSalesList(rows);

  if (typeof L === "undefined") return; // el mapa no cargó, pero la lista sigue mostrándose

  const countByCode = {};
  rows.forEach((r) => {
    const code = (r.country_code || "").toUpperCase();
    if (code) countByCode[code] = r.sales_count;
  });
  const maxCount = Math.max(...Object.values(countByCode), 1);

  hideCultsSalesPopup();

  let geojson;
  try {
    if (!window.__cultsWorldGeoJson) {
      const resp = await fetch(CULTS_GEOJSON_URL);
      window.__cultsWorldGeoJson = await resp.json();
    }
    geojson = window.__cultsWorldGeoJson;
  } catch (err) {
    console.warn("[rabbit3d] No se pudo cargar el contorno de los países:", err);
    return;
  }

  if (!cultsLeafletMap) {
    cultsLeafletMap = L.map("cultsSalesMap", {
      minZoom: 1,
      maxZoom: 6,
      maxBounds: [
        [-85, -200],
        [85, 200],
      ],
      maxBoundsViscosity: 1,
      worldCopyJump: false,
      attributionControl: false,
    }).setView([15, 10], 1.3);
  } else {
    cultsLeafletMap.eachLayer((layer) => cultsLeafletMap.removeLayer(layer));
  }

  L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: cultsColorForCount(countByCode[neIso2(feature.properties)] || 0, maxCount),
      fillOpacity: 1,
      color: "#0A0F1A",
      weight: 0.6,
    }),
    onEachFeature: (feature, layer) => {
      const code = neIso2(feature.properties);
      const count = countByCode[code];
      if (count) {
        layer.on("click", () => showCultsSalesPopup(code, count));
      }
    },
  }).addTo(cultsLeafletMap);

  // Un punto por cada venta individual: en países con ciudades definidas
  // arriba, la mayoría cae cerca de esas ciudades (con su ubicación real);
  // el resto se reparte al azar dentro del contorno verdadero del país.
  Object.entries(countByCode).forEach(([code, count]) => {
    const feature = geojson.features.find((f) => neIso2(f.properties) === code);
    if (!feature) return;
    const hotspots = CULTS_COUNTRY_HOTSPOTS[code];
    const parts = cultsPolygonParts(feature.geometry);

    for (let i = 0; i < count; i++) {
      let point = null;
      if (hotspots && hotspots.length && Math.random() < CULTS_HOTSPOT_PROBABILITY) {
        point = pickWeightedHotspot(hotspots);
      } else {
        point = cultsRandomPointInGeometry(parts);
      }
      if (!point) continue;
      L.circleMarker([point.lat, point.lng], {
        radius: 2.5,
        color: "#E8125C",
        weight: 1,
        fillColor: "#FFFFFF",
        fillOpacity: 0.9,
        interactive: false, // los clics siguen yendo al país de abajo
      }).addTo(cultsLeafletMap);
    }
  });

  setTimeout(() => cultsLeafletMap.invalidateSize(), 60);
}

function showCultsSalesPopup(code, count) {
  const popup = document.getElementById("cultsSalesPopup");
  const name = CULTS_COUNTRY_NAMES_ES[code] || code;
  const flagUrl = `https://cdn.jsdelivr.net/gh/hjnilsson/country-flags@latest/svg/${code.toLowerCase()}.svg`;
  popup.innerHTML = `
    <img src="${flagUrl}" alt="" class="sales-map-popup-flag">
    <div class="sales-map-popup-info">
      <span class="sales-map-popup-name">${escapeHtml(name)}</span>
      <span class="sales-map-popup-count">${count} venta${count === 1 ? "" : "s"}</span>
    </div>
    <button type="button" class="sales-map-popup-close" aria-label="Cerrar">×</button>
  `;
  popup.style.display = "flex";
  popup.querySelector(".sales-map-popup-close").addEventListener("click", hideCultsSalesPopup);
}

function hideCultsSalesPopup() {
  const popup = document.getElementById("cultsSalesPopup");
  if (popup) popup.style.display = "none";
}

const CULTS_SALES_LIST_PREVIEW = 10;

function renderCultsSalesList(rows) {
  const list = document.getElementById("cultsSalesList");
  const toggleBtn = document.getElementById("cultsSalesListToggle");
  list.innerHTML = "";

  const sorted = [...rows].sort((a, b) => b.sales_count - a.sales_count);
  const maxSales = Math.max(...sorted.map((r) => r.sales_count), 1);

  function buildRow(r) {
    const code = (r.country_code || "").toLowerCase();
    const flagUrl = `https://cdn.jsdelivr.net/gh/hjnilsson/country-flags@latest/svg/${code}.svg`;
    const row = document.createElement("div");
    row.className = "sales-country-row";
    row.innerHTML = `
      <img src="${flagUrl}" alt="" class="sales-country-flag">
      <span class="sales-country-name">${escapeHtml(r.country_name)}</span>
      <div class="sales-country-bar-track"><div class="sales-country-bar-fill" style="width:${(r.sales_count / maxSales) * 100}%"></div></div>
      <span class="sales-country-count">${r.sales_count}</span>
    `;
    return row;
  }

  const top = sorted.slice(0, CULTS_SALES_LIST_PREVIEW);
  const rest = sorted.slice(CULTS_SALES_LIST_PREVIEW);
  top.forEach((r) => list.appendChild(buildRow(r)));

  if (!rest.length) {
    toggleBtn.style.display = "none";
    return;
  }

  toggleBtn.style.display = "inline-flex";
  toggleBtn.textContent = `Ver todos (${rest.length} más)`;
  toggleBtn.dataset.expanded = "false";
  toggleBtn.onclick = () => {
    const expanded = toggleBtn.dataset.expanded === "true";
    if (expanded) {
      Array.from(list.querySelectorAll(".sales-country-row"))
        .slice(CULTS_SALES_LIST_PREVIEW)
        .forEach((el) => el.remove());
      toggleBtn.textContent = `Ver todos (${rest.length} más)`;
      toggleBtn.dataset.expanded = "false";
    } else {
      rest.forEach((r) => list.appendChild(buildRow(r)));
      toggleBtn.textContent = "Ver menos";
      toggleBtn.dataset.expanded = "true";
    }
  };
}

async function setupIndustriaCardImages() {
  const allMedia = (await safeFetchAllIndustriaMedia()) || [];
  const byKey = {};
  allMedia.forEach((m) => {
    (byKey[m.card_key] = byKey[m.card_key] || []).push(m);
  });

  document.querySelectorAll("#industriaCardsGrid .process-card").forEach((card) => {
    const key = card.dataset.industriaKey;
    const items = byKey[key];
    if (!items || !items.length) return;
    const first = items[0];

    const bgUrl =
      first.media_type === "image"
        ? window.Rabbit3DData?.buildImageUrl
          ? window.Rabbit3DData.buildImageUrl(first.image_path, 480)
          : first.image_path
        : anyVideoThumbnail(first.video_url);
    if (!bgUrl) return;

    card.classList.add("has-image");
    card.style.setProperty("--ind-bg-image", `url("${bgUrl}")`);
    card.style.setProperty("--ind-focal", `${first.focal_x ?? 50}% ${first.focal_y ?? 50}%`);
    card.setAttribute("tabindex", "0");

    const cardTitle = card.querySelector("h3")?.textContent || "";
    const open = () => openIndustriaLightbox(key, cardTitle);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderIndustriaMainMedia(m) {
  const main = document.getElementById("industriaLightboxMain");
  if (!m) {
    main.innerHTML = "";
    return;
  }
  if (m.media_type === "image") {
    const url = window.Rabbit3DData?.buildImageUrl
      ? window.Rabbit3DData.buildImageUrl(m.image_path, 800)
      : m.image_path;
    main.innerHTML = `<img src="${url}" alt="${escapeHtml(m.caption || "")}" style="${focalStyle(m)}">`;
    return;
  }
  const driveId = driveFileId(m.video_url);
  const ytId = youtubeEmbedInfo(m.video_url);
  if (driveId) {
    main.innerHTML = `<iframe src="https://drive.google.com/file/d/${driveId}/preview" title="${escapeHtml(m.caption || "Video")}" allow="autoplay" allowfullscreen></iframe>`;
  } else if (ytId) {
    main.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}" title="${escapeHtml(m.caption || "Video")}" allowfullscreen></iframe>`;
  } else {
    main.innerHTML = `
      <a href="${m.video_url}" target="_blank" rel="noopener" class="play-badge" style="position:static; height:100%">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="#fff"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><path d="M10 8.5v7l6-3.5z"/></svg>
      </a>`;
  }
}

async function openIndustriaLightbox(cardKey, cardTitle) {
  const backdrop = document.getElementById("industriaLightboxBackdrop");
  document.getElementById("industriaLightboxTitle").textContent = cardTitle || "";
  const main = document.getElementById("industriaLightboxMain");
  const thumbs = document.getElementById("industriaLightboxThumbs");
  main.innerHTML = "";
  thumbs.innerHTML = "";
  backdrop.hidden = false;

  const media = (await safeFetchIndustriaMediaByKey(cardKey)) || [];
  if (!media.length) {
    main.innerHTML = `<div class="gallery-placeholder">📦<br>Todavía no hay fotos ni videos cargados.</div>`;
    return;
  }

  renderIndustriaMainMedia(media[0]);

  if (media.length > 1) {
    media.forEach((m, i) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "category-modal-thumb" + (i === 0 ? " is-active" : "");
      if (m.media_type === "image") {
        const url = window.Rabbit3DData?.buildImageUrl
          ? window.Rabbit3DData.buildImageUrl(m.image_path, 120)
          : m.image_path;
        thumb.innerHTML = `<img src="${url}" alt="" style="${focalStyle(m)}">`;
      } else {
        const thumbUrl = anyVideoThumbnail(m.video_url);
        thumb.innerHTML = thumbUrl
          ? `<img src="${thumbUrl}" alt=""><span class="thumb-play">▶</span>`
          : `<span class="thumb-play">🎬</span>`;
      }
      thumb.addEventListener("click", () => {
        thumbs.querySelectorAll(".category-modal-thumb").forEach((t) => t.classList.remove("is-active"));
        thumb.classList.add("is-active");
        renderIndustriaMainMedia(m);
      });
      thumbs.appendChild(thumb);
    });
  }
}

function setupIndustriaLightbox() {
  const backdrop = document.getElementById("industriaLightboxBackdrop");
  const closeBtn = document.getElementById("industriaLightboxClose");

  function closeModal() {
    backdrop.hidden = true;
    document.getElementById("industriaLightboxMain").innerHTML = "";
    document.getElementById("industriaLightboxThumbs").innerHTML = "";
  }
  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });
}

function applySettings(settings) {
  if (!settings) return; // sin Supabase configurado, se mantiene el contenido de ejemplo del HTML

  const clientesWrapper = document.getElementById("clientesWrapper");
  const footerClientesLink = document.getElementById("footerClientesLink");
  const showClientes = !!settings.show_clientes;
  if (clientesWrapper) clientesWrapper.hidden = !showClientes;
  if (footerClientesLink) footerClientesLink.hidden = !showClientes;

  const waNumber = (settings.whatsapp_number || "").replace(/\D/g, "");
  if (waNumber) {
    currentWhatsappNumber = waNumber;
    const footerWaText = document.getElementById("footerWaText");
    if (footerWaText) footerWaText.textContent = `+${waNumber}`;
  }

  if (settings.instagram_handle) {
    const footerIg = document.getElementById("footerInstagramLink");
    if (footerIg) {
      footerIg.href = `https://instagram.com/${settings.instagram_handle}`;
      footerIg.textContent = `@${settings.instagram_handle}`;
    }
  }

  if (settings.contact_email) {
    const footerEmail = document.getElementById("footerEmailLink");
    if (footerEmail) {
      footerEmail.href = `mailto:${settings.contact_email}`;
      footerEmail.textContent = settings.contact_email;
    }
  }

  if (settings.zone_text) {
    const footerZone = document.getElementById("footerZoneText");
    if (footerZone) footerZone.textContent = settings.zone_text;
  }

  if (settings.cults3d_url) {
    const btn = document.getElementById("cults3dBtn");
    if (btn) btn.href = settings.cults3d_url;
  }

  if (settings.telegram_url) {
    const btn = document.getElementById("telegramBtn");
    if (btn) {
      btn.href = settings.telegram_url;
      btn.hidden = false;
    }
  }

  replacePhotoFrame(
    "sobreMiPhotoFrame",
    settings.profile_photo_path,
    "Foto del taller de Rabbit3D",
    focalPosition({ focal_x: settings.profile_photo_focal_x, focal_y: settings.profile_photo_focal_y }),
    settings.profile_photo_zoom
  );
}

function replacePhotoFrame(frameId, imagePath, alt, objectPosition, zoom) {
  if (!imagePath) return;
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const url = window.Rabbit3DData?.buildImageUrl
    ? window.Rabbit3DData.buildImageUrl(imagePath, 800)
    : imagePath;
  const img = document.createElement("img");
  img.src = url;
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.style.objectPosition = objectPosition || "50% 50%";
  img.style.transform = `scale(${(zoom != null ? zoom : 100) / 100})`;
  img.style.borderRadius = "var(--radius)";
  frame.replaceWith(img);
  img.id = frameId; // por si algo más lo busca por id después
}


// ---------------------------------------------------------------
// LOGIN / PANEL DE ADMINISTRADOR (ícono de cuenta en el header)
// ---------------------------------------------------------------
function setupAuth() {
  const client = window.Rabbit3DData?.client;
  const accountTriggers = document.querySelectorAll("#accountBtn, #bottomNavAccount");
  if (!client) {
    accountTriggers.forEach((btn) => (btn.style.display = "none")); // sin Supabase configurado todavía
    return;
  }

  const backdrop = document.getElementById("accountModalBackdrop");
  const closeBtn = document.getElementById("accountModalClose");
  const closeLink = document.getElementById("accountModalCloseLink");
  const loggedOutView = document.getElementById("accountLoggedOut");
  const loggedInView = document.getElementById("accountLoggedIn");
  const form = document.getElementById("loginForm");
  const status = document.getElementById("loginModalStatus");
  const adminPanelBtn = document.getElementById("adminPanelBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const accountEmailText = document.getElementById("accountEmailText");
  const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

  function openModal() {
    backdrop.hidden = false;
    status.className = "modal-status";
    status.textContent = "";
  }
  function closeModal() {
    backdrop.hidden = true;
  }

  accountTriggers.forEach((btn) => btn.addEventListener("click", openModal));
  closeBtn.addEventListener("click", closeModal);
  closeLink.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.className = "modal-status";
    status.textContent = "Ingresando…";

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const { error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      status.className = "modal-status err";
      status.textContent = "No se pudo iniciar sesión: " + error.message;
      return;
    }
    status.className = "modal-status ok";
    status.textContent = "¡Listo!";
    form.reset();
  });

  forgotPasswordBtn.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value.trim();
    if (!email) {
      status.className = "modal-status err";
      status.textContent = "Escribí tu email arriba y volvé a tocar el link.";
      return;
    }
    status.className = "modal-status";
    status.textContent = "Enviando…";
    const { error } = await client.auth.resetPasswordForEmail(email);
    status.className = error ? "modal-status err" : "modal-status ok";
    status.textContent = error
      ? "No se pudo enviar: " + error.message
      : "Listo, revisá tu email para restablecer la contraseña.";
  });

  logoutBtn.addEventListener("click", async () => {
    await client.auth.signOut();
  });

  // Muestra el acceso al panel admin solo si el usuario está en rabbit3d_admins.
  async function refreshAuthUI(session) {
    if (!session) {
      loggedOutView.hidden = false;
      loggedInView.hidden = true;
      accountTriggers.forEach((btn) => btn.classList.remove("is-admin"));
      return;
    }
    let isAdmin = false;
    try {
      const { data } = await client
        .from("rabbit3d_admins")
        .select("user_id")
        .eq("user_id", session.user.id)
        .maybeSingle();
      isAdmin = !!data;
    } catch {
      isAdmin = false;
    }
    loggedOutView.hidden = true;
    loggedInView.hidden = false;
    accountEmailText.textContent = session.user.email;
    adminPanelBtn.hidden = !isAdmin;
    accountTriggers.forEach((btn) => btn.classList.toggle("is-admin", isAdmin));
  }

  client.auth.onAuthStateChange((_event, session) => refreshAuthUI(session));
  client.auth.getSession().then(({ data }) => refreshAuthUI(data?.session || null));
}

// ---------------------------------------------------------------
// WHATSAPP (número resuelto dinámicamente desde applySettings)
// ---------------------------------------------------------------
let currentWhatsappNumber = "5490000000000"; // se actualiza desde applySettings() si hay Supabase configurado
const MIN_ORDER_QTY = 50; // mínimo de pedido, fijo para todo el sitio

// ---------------------------------------------------------------
// CATEGORÍAS (pedidos por cantidad)
// ---------------------------------------------------------------
function categoryCard(c, fallbackMedia, priceTiers) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "category-card";

  let imgUrl = window.Rabbit3DData?.buildImageUrl
    ? window.Rabbit3DData.buildImageUrl(c.cover_image_path, 480)
    : null;
  let focalX = c.cover_focal_x;
  let focalY = c.cover_focal_y;
  let focalZoom = c.cover_zoom;

  // Si no cargaste una foto de portada, usamos la primera foto que
  // hayas subido en "Fotos/videos" de esa categoría como respaldo.
  if (!imgUrl && fallbackMedia) {
    imgUrl = window.Rabbit3DData?.buildImageUrl
      ? window.Rabbit3DData.buildImageUrl(fallbackMedia.image_path, 480)
      : fallbackMedia.image_path;
    focalX = fallbackMedia.focal_x;
    focalY = fallbackMedia.focal_y;
    focalZoom = fallbackMedia.zoom;
  }

  const hasTiers = priceTiers && priceTiers.length > 0;

  // Precio de entrada, visible de un vistazo sobre la propia foto —
  // Todos los precios cargados, uno por cantidad — estilo "carta de
  // menú" (cantidad ...... precio). Si todavía no cargaste ninguno, cae
  // a la nota de precio libre, o "Consultar precio".
  const priceHtml = hasTiers
    ? `<div class="category-price-rows">
        ${priceTiers
          .map(
            (p) => `
          <div class="category-price-row">
            <span class="cpr-qty">${p.quantity} unidades</span>
            <span class="cpr-leader"></span>
            <span class="cpr-price">$${Number(p.total_price).toLocaleString("es-AR")}</span>
          </div>`
          )
          .join("")}
      </div>`
    : `<p class="category-price-note">${escapeHtml(c.price_note || "Consultar precio")}</p>`;

  card.innerHTML = `
    <div class="category-media">
      ${
        imgUrl
          ? `<img src="${imgUrl}" alt="${escapeHtml(c.name)}" loading="lazy" decoding="async" width="480" height="360" style="${focalStyle({ focal_x: focalX, focal_y: focalY, zoom: focalZoom })}">`
          : `<div class="gallery-placeholder">📦<br>Foto pendiente</div>`
      }
    </div>
    <div class="category-body">
      <h3>${escapeHtml(c.name)}</h3>
      <p class="category-desc">${escapeHtml(c.description || "")}</p>
      ${priceHtml}
      <span class="category-cta">
        Ver detalles
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </span>
    </div>
  `;
  card.addEventListener("click", () => openCategoryModal(c));
  return card;
}

async function renderCategories(categories) {
  const grid = document.getElementById("categoryGrid");
  const empty = document.getElementById("categoryEmpty");
  if (!grid) return;
  grid.innerHTML = "";
  empty.hidden = categories.length > 0;

  // Una sola consulta para los precios de TODAS las categorías, en vez
  // de una por tarjeta.
  const allPricing = (await safeFetchAllCategoryPricing()) || [];
  const pricingByCategory = {};
  allPricing.forEach((p) => {
    if (!pricingByCategory[p.category_id]) pricingByCategory[p.category_id] = [];
    pricingByCategory[p.category_id].push(p);
  });

  for (const c of categories) {
    let fallbackMedia = null;
    if (!c.cover_image_path) {
      const media = (await safeFetchCategoryMedia(c.id)) || [];
      const imageItem = media.find((m) => m.media_type === "image");
      if (imageItem) {
        fallbackMedia = imageItem;
      } else {
        // Si lo único cargado son videos, usamos la miniatura del primero
        // que tenga (en vez de dejar la tarjeta con "Foto pendiente").
        const videoItem = media.find((m) => m.media_type === "video" && anyVideoThumbnail(m.video_url));
        if (videoItem) {
          fallbackMedia = { image_path: anyVideoThumbnail(videoItem.video_url), focal_x: 50, focal_y: 50 };
        }
      }
    }
    grid.appendChild(categoryCard(c, fallbackMedia, pricingByCategory[c.id] || null));
  }

  adjustCategoryGridLayout();
}

// En celular se intenta 2 categorías por fila (más compacto). Si algún
// precio no entra en una sola línea con ese ancho más angosto, se pasa
// TODO el grid a 1 por fila, para que quede prolijo y legible en vez de
// cortado. Se vuelve a probar en 2 columnas cada vez (por si la
// pantalla rotó o cambió de tamaño), antes de decidir si hace falta bajar a 1.
function adjustCategoryGridLayout() {
  const grid = document.getElementById("categoryGrid");
  if (!grid) return;

  if (window.innerWidth > 560) {
    grid.classList.remove("force-single-col");
    return;
  }

  grid.classList.remove("force-single-col");
  void grid.offsetWidth; // fuerza a recalcular el layout con 2 columnas antes de medir

  let overflow = false;
  grid.querySelectorAll(".category-price-row").forEach((row) => {
    if (row.scrollWidth > row.clientWidth + 1) overflow = true;
  });

  if (overflow) grid.classList.add("force-single-col");
}

let categoryGridResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(categoryGridResizeTimer);
  categoryGridResizeTimer = setTimeout(adjustCategoryGridLayout, 150);
});
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(adjustCategoryGridLayout); // por si la fuente definitiva mide distinto que la de respaldo
}


function youtubeEmbedInfo(url) {
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

// Miniatura de un video de Drive (Google genera una automáticamente para
// casi cualquier archivo, siempre que esté compartido públicamente).
function anyVideoThumbnail(url) {
  return driveThumbnail(url) || youtubeThumbnail(url);
}

function renderCategoryMainMedia(m) {
  const main = document.getElementById("categoryModalMain");
  if (!m) {
    main.innerHTML = "";
    return;
  }
  if (m.media_type === "image") {
    const url = window.Rabbit3DData?.buildImageUrl
      ? window.Rabbit3DData.buildImageUrl(m.image_path, 800)
      : m.image_path;
    main.innerHTML = `<img src="${url}" alt="${escapeHtml(m.caption || "")}" style="${focalStyle(m)}">`;
    return;
  }
  const driveId = driveFileId(m.video_url);
  const ytId = youtubeEmbedInfo(m.video_url);
  if (driveId) {
    main.innerHTML = `<iframe src="https://drive.google.com/file/d/${driveId}/preview" title="${escapeHtml(m.caption || "Video")}" allow="autoplay" allowfullscreen></iframe>`;
  } else if (ytId) {
    main.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}" title="${escapeHtml(m.caption || "Video")}" allowfullscreen></iframe>`;
  } else {
    main.innerHTML = `
      <a href="${m.video_url}" target="_blank" rel="noopener" class="play-badge" style="position:static; height:100%">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="#fff"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><path d="M10 8.5v7l6-3.5z"/></svg>
      </a>`;
  }
}

async function openCategoryModal(category) {
  const backdrop = document.getElementById("categoryModalBackdrop");
  document.getElementById("categoryModalMinQty").textContent = `Mínimo ${MIN_ORDER_QTY} unidades`;
  document.getElementById("categoryModalTitle").textContent = category.name;
  document.getElementById("categoryModalDescription").textContent = category.description || "";
  document.getElementById("categoryModalPriceNote").textContent = category.price_note || "";

  const waBtn = document.getElementById("categoryModalWhatsapp");
  waBtn.onclick = () => {
    openWhatsappModal(`un pedido de "${category.name}" (mínimo ${MIN_ORDER_QTY} unidades)`);
  };

  const pricingWrap = document.getElementById("categoryModalPricing");
  pricingWrap.innerHTML = "";
  const gallery = document.getElementById("categoryModalGallery");
  const main = document.getElementById("categoryModalMain");
  const thumbs = document.getElementById("categoryModalThumbs");
  gallery.style.display = "none";
  main.innerHTML = "";
  thumbs.innerHTML = "";
  backdrop.hidden = false;
  backdrop.querySelector(".category-modal-scroll").scrollTop = 0;

  safeFetchCategoryPricing(category.id).then((pricing) => {
    if (!pricing || !pricing.length) return;
    pricingWrap.innerHTML = pricing
      .map(
        (p) => `
        <span class="category-pricing-chip">
          <span class="cpi-qty">${p.quantity} un.</span>
          <span class="cpi-price">$${Number(p.total_price).toLocaleString("es-AR")}</span>
        </span>`
      )
      .join("");
  });

  const media = (await safeFetchCategoryMedia(category.id)) || [];
  if (!media.length) {
    gallery.style.display = "block";
    main.innerHTML = `<div class="gallery-placeholder">📦<br>Todavía no hay fotos ni videos cargados de este producto.</div>`;
    return;
  }

  gallery.style.display = "block";
  renderCategoryMainMedia(media[0]);

  if (media.length > 1) {
    media.forEach((m, i) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "category-modal-thumb" + (i === 0 ? " is-active" : "");
      if (m.media_type === "image") {
        const url = window.Rabbit3DData?.buildImageUrl
          ? window.Rabbit3DData.buildImageUrl(m.image_path, 120)
          : m.image_path;
        thumb.innerHTML = `<img src="${url}" alt="" style="${focalStyle(m)}">`;
      } else {
        const thumbUrl = anyVideoThumbnail(m.video_url);
        thumb.innerHTML = thumbUrl
          ? `<img src="${thumbUrl}" alt=""><span class="thumb-play">▶</span>`
          : `<span class="thumb-play">🎬</span>`;
      }
      thumb.addEventListener("click", () => {
        thumbs.querySelectorAll(".category-modal-thumb").forEach((t) => t.classList.remove("is-active"));
        thumb.classList.add("is-active");
        renderCategoryMainMedia(m);
      });
      thumbs.appendChild(thumb);
    });
  }
}

function youtubeThumbnail(url) {
  const match = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg` : null;
}

function setupCategoryModal() {
  const backdrop = document.getElementById("categoryModalBackdrop");
  const closeBtn = document.getElementById("categoryModalClose");
  const closeLink = document.getElementById("categoryModalCloseLink");

  function closeModal() {
    backdrop.hidden = true;
    document.getElementById("categoryModalMain").innerHTML = "";
    document.getElementById("categoryModalThumbs").innerHTML = "";
    document.getElementById("categoryModalPricing").innerHTML = "";
  }
  closeBtn.addEventListener("click", closeModal);
  closeLink.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });
}

// ---------------------------------------------------------------
// MODAL DE CONTACTO POR WHATSAPP — pide nombre y localidad antes
// de armar el mensaje, para todos los botones de WhatsApp del sitio.
// ---------------------------------------------------------------
let waModalContext = "hacer una consulta";

function openWhatsappModal(contextText) {
  waModalContext = contextText || "hacer una consulta";
  document.getElementById("waModalBackdrop").hidden = false;
  document.getElementById("wa_name").focus();
}

function setupWhatsappModal() {
  const backdrop = document.getElementById("waModalBackdrop");
  const closeBtn = document.getElementById("waModalClose");
  const closeLink = document.getElementById("waModalCloseLink");
  const form = document.getElementById("waModalForm");

  function closeModal() {
    backdrop.hidden = true;
  }
  closeBtn.addEventListener("click", closeModal);
  closeLink.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) closeModal();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("wa_name").value.trim();
    const locality = document.getElementById("wa_locality").value.trim();
    if (!name || !locality) return;

    const message = `Hola Rabbit3D, soy ${name} de ${locality}, estoy interesado por ${waModalContext}.`;
    const url = `https://wa.me/${currentWhatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener");
    closeModal();
    form.reset();
  });

  // Botones fijos del sitio que abren el modal con su propio contexto.
  const triggers = [
    { id: "headerContactBtn", context: "hacer una consulta" },
    { id: "heroContactBtn", context: "hacer un pedido" },
    { id: "bottomNavWhatsapp", context: "hacer una consulta" },
    { id: "footerWaText", context: "hacer una consulta" },
  ];
  triggers.forEach(({ id, context }) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener("click", () => openWhatsappModal(context));
  });
}

// ---------------------------------------------------------------
// NAV MÓVIL
// ---------------------------------------------------------------
function setupNavToggle() {
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("main-nav");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    })
  );
}

// ---------------------------------------------------------------
// GALERÍA DE TALLER (fotos cuadradas, grilla de a varias)
// ---------------------------------------------------------------
function renderGallery(category, items) {
  const el = document.getElementById(`${category}Gallery`);
  if (!el) return;
  el.innerHTML = "";

  if (!items.length) {
    // Placeholders prolijos para que la sección nunca se vea vacía/rota.
    for (let i = 0; i < 4; i++) {
      const div = document.createElement("div");
      div.className = "gallery-item";
      div.innerHTML = `<div class="gallery-placeholder">🖼️<br>${GALLERY_PLACEHOLDER_TEXT[category]}</div>`;
      el.appendChild(div);
    }
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "gallery-item";

    if (item.media_type === "video") {
      const driveId = driveFileId(item.video_url);
      const ytId = youtubeEmbedInfo(item.video_url);
      if (driveId || ytId) {
        div.classList.add("is-video");
        const thumbUrl = anyVideoThumbnail(item.video_url);
        div.innerHTML = `
          ${thumbUrl ? `<img src="${thumbUrl}" alt="" loading="lazy">` : ""}
          <span class="play-badge">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><path d="M10 8.5v7l6-3.5z"/></svg>
          </span>
          ${item.title ? `<span class="gallery-caption">${escapeHtml(item.title)}</span>` : ""}
        `;
        div.addEventListener("click", () => {
          const src = driveId ? `https://drive.google.com/file/d/${driveId}/preview` : `https://www.youtube.com/embed/${ytId}?autoplay=1`;
          div.classList.remove("is-video");
          div.innerHTML = `<iframe src="${src}" title="${escapeHtml(item.title || "Video")}" allow="autoplay" allowfullscreen></iframe>`;
        });
      } else {
        div.innerHTML = `
          <a href="${item.video_url}" target="_blank" rel="noopener" style="display:block; width:100%; height:100%; background:var(--bg-panel-2)">
            <span class="play-badge">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="#fff"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><path d="M10 8.5v7l6-3.5z"/></svg>
            </span>
            ${item.title ? `<span class="gallery-caption">${escapeHtml(item.title)}</span>` : ""}
          </a>
        `;
      }
    } else {
      const url = window.Rabbit3DData?.buildImageUrl
        ? window.Rabbit3DData.buildImageUrl(item.image_path, 480)
        : item.image_path;
      div.innerHTML = `
        <img src="${url}" alt="${escapeHtml(item.alt_text || item.title || "")}" loading="lazy" decoding="async" width="480" height="480" style="${focalStyle(item)}">
        ${item.title ? `<span class="gallery-caption">${escapeHtml(item.title)}</span>` : ""}
      `;
    }
    el.appendChild(div);
  });
}

// ---------------------------------------------------------------
// GALERÍAS HORIZONTALES (Prensa, Charlas, Clientes) — pensadas para
// pocas fotos panorámicas, no una grilla de muchas piezas cuadradas.
// ---------------------------------------------------------------
const PRESS_CONFIG = {
  prensa: { badge: "En TV", icon: "📺", placeholders: ["Sumá tu primera entrevista de TV", "Sumá tu segunda entrevista de TV"] },
  charlas: { badge: "Charla", icon: "🎤", placeholders: ["Sumá una foto de tu charla o exposición"] },
  clientes: { badge: "Cliente", icon: "⭐", placeholders: ["Sumá una foto con tu cliente destacado"] },
};

function renderPress(category, items) {
  const el = document.getElementById(`${category}Gallery`);
  const config = PRESS_CONFIG[category];
  if (!el || !config) return;
  el.innerHTML = "";

  if (!items.length) {
    config.placeholders.forEach((label) => {
      const div = document.createElement("div");
      div.className = "press-item";
      div.innerHTML = `<div class="press-placeholder">${config.icon}<br>${label}</div>`;
      el.appendChild(div);
    });
    return;
  }

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "press-item";

    if (item.media_type === "video") {
      const driveId = driveFileId(item.video_url);
      const ytId = youtubeEmbedInfo(item.video_url);
      const caption = item.title || item.event_date
        ? `<div class="press-caption">
             ${item.title ? `<strong>${escapeHtml(item.title)}</strong>` : ""}
             ${item.event_date ? `<span>${escapeHtml(item.event_date)}</span>` : ""}
           </div>`
        : "";
      if (driveId || ytId) {
        const src = driveId ? `https://drive.google.com/file/d/${driveId}/preview` : `https://www.youtube.com/embed/${ytId}`;
        div.innerHTML = `
          <div class="press-media">
            <span class="press-badge">${config.badge}</span>
            <iframe src="${src}" title="${escapeHtml(item.title || "Video")}" loading="lazy" allowfullscreen></iframe>
          </div>
          ${caption}
        `;
      } else {
        div.innerHTML = `
          <a href="${item.video_url}" target="_blank" rel="noopener" class="press-media" style="display:block; background:var(--bg-panel-2)">
            <span class="press-badge">${config.badge}</span>
            <span class="play-badge">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="#fff"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><path d="M10 8.5v7l6-3.5z"/></svg>
            </span>
          </a>
          ${caption}
        `;
      }
    } else {
      const url = window.Rabbit3DData?.buildImageUrl
        ? window.Rabbit3DData.buildImageUrl(item.image_path, 800)
        : item.image_path;
      div.innerHTML = `
        <div class="press-media">
          <span class="press-badge">${config.badge}</span>
          <img src="${url}" alt="${escapeHtml(item.alt_text || item.title || "")}" loading="lazy" decoding="async" width="800" height="450" style="${focalStyle(item)}">
        </div>
        ${
          item.title || item.event_date
            ? `<div class="press-caption">
                 ${item.title ? `<strong>${escapeHtml(item.title)}</strong>` : ""}
                 ${item.event_date ? `<span>${escapeHtml(item.event_date)}</span>` : ""}
               </div>`
            : ""
        }
      `;
    }
    el.appendChild(div);
  });
}

function focalPosition(item) {
  const x = item?.focal_x != null ? item.focal_x : 50;
  const y = item?.focal_y != null ? item.focal_y : 50;
  return `${x}% ${y}%`;
}

// Igual que focalPosition, pero además aplica el zoom guardado desde el
// panel (si no tiene, queda en 100% = sin zoom, tal cual estaba antes).
// Se pasa como variable CSS (--photo-zoom) en vez de "transform" directo,
// para no pisar animaciones de hover que ya usan transform en algunas fotos.
function focalStyle(item) {
  const zoom = item?.zoom != null ? item.zoom : 100;
  return `object-position:${focalPosition(item)}; --photo-zoom:${zoom / 100}`;
}

// Acordeón de "¿Cómo funciona la impresión 3D?" — solo tiene efecto
// visual en pantallas angostas (ver @media 560px en el CSS); en
// pantallas más anchas el CSS ya deja todo abierto siempre.
document.querySelectorAll("#impresion-3d .process-card-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const card = btn.closest(".process-card");
    const isOpen = card.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
});


