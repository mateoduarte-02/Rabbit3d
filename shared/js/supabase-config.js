/**
 * Credenciales de Supabase — compartidas por las 4 páginas de Rabbit3D
 * (index.html, admin.html, finanzas.html, ventas.html).
 *
 * Si alguna vez rotás la anon key, actualizala ACÁ ÚNICAMENTE — antes
 * estaba pegada a mano en cada uno de los 4 archivos, que es justo lo
 * que este módulo compartido evita.
 *
 * La anon key es pública por diseño (viaja en el navegador de cualquier
 * visitante); el acceso real se controla con las políticas de Row Level
 * Security (RLS) del archivo sql/schema.sql — esa key solo puede hacer
 * lo que esas políticas permiten.
 *
 * Como la base de datos es compartida con otros proyectos, todas las
 * tablas y el bucket de imágenes de Rabbit3D usan el prefijo
 * "rabbit3d_" / "rabbit3d-media" para no chocar con nada más.
 */
export const SUPABASE_URL = "https://jcrpxrfjenjdgqtwkiyw.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjcnB4cmZqZW5qZGdxdHdraXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNzAzMDYsImV4cCI6MjA5MDg0NjMwNn0.eygcb6oGMkXRUXoJUCs_9B5yr5doF3LrQn9C1-eYHpE";
export const STORAGE_BUCKET = "rabbit3d-media";

/**
 * Crea un cliente de Supabase listo para usar. Requiere que el SDK de
 * Supabase ya esté cargado globalmente (el <script> de jsdelivr antes
 * de este módulo en el <head>/<body> de cada página).
 */
export function createSupabaseClient() {
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
