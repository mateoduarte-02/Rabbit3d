/**
 * Helpers de fecha compartidos por finanzas.html y ventas.html.
 */

/**
 * "Hoy" según la hora LOCAL del navegador, no UTC — `toISOString()` antes
 * convertía a UTC primero, y como Argentina está 3 horas atrás, cargar
 * algo de noche (21:00 en adelante) hacía que "hoy" saliera como el día
 * siguiente, ya que en UTC ya era otro día.
 */
export function todayLocalISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Los campos <input type="date"> necesitan sí o sí el formato ISO
 * (año-mes-día) para funcionar — esto es solo para MOSTRAR la fecha ya
 * guardada de forma más natural (día/mes/año), en tablas y listas.
 */
export function formatDateDisplay(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
