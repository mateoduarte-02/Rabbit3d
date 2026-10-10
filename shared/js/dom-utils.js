/**
 * Helpers chicos de DOM/texto, compartidos por las 4 páginas.
 */

/** Escapa texto antes de insertarlo como HTML (evita inyección y tags rotos). */
export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
