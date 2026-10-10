/**
 * Links directos a Google Drive — para mostrar fotos/videos sin
 * redirigir fuera de la página (el archivo debe estar compartido como
 * "Cualquiera con el enlace puede ver"). Compartido por index.html,
 * admin.html y ventas.html.
 */

export function driveFileId(url) {
  const m =
    String(url).match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export function driveImageUrl(url) {
  const id = driveFileId(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}` : null;
}

/** Miniatura de un video de Drive (Google genera una automáticamente para
 * casi cualquier archivo, siempre que esté compartido públicamente). */
export function driveThumbnail(url) {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w320` : null;
}
