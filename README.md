# Rabbit3D — sitio web

Sitio estático (HTML/CSS/JS puro, sin build) para el emprendimiento de impresión 3D
Rabbit3D. Pensado para alojarse gratis en **GitHub Pages** y usar **Supabase**
(compartido con otros proyectos) para el catálogo de productos y las galerías
de fotos, así podés actualizar contenido sin tocar código.

Si no cargás nada en Supabase, el sitio igual funciona: muestra productos de
ejemplo y espacios placeholder prolijos en las galerías, para que nunca se vea
"roto" mientras vas cargando tus datos reales.

## Estructura del proyecto

Cada página es su propia carpeta con su CSS y su JS al lado (más fácil de
encontrar algo puntual que un solo archivo de miles de líneas), y lo que
las 4 páginas comparten vive en `shared/`:

```
index.html                    el sitio público (HTML liviano, importa shared/ y site/)
site/site.css                 estilos propios de index.html
site/site.js                  lógica propia de index.html (catálogo, galerías, mapa de ventas)

admin/admin.html               panel de carga (con login) para vos y futuros colaboradores
admin/admin.css
admin/admin.js

finanzas/finanzas.html         tracker de ingresos/gastos (privado)
finanzas/finanzas.css
finanzas/finanzas.js

ventas/ventas.html             reposiciones de llaveros para empleados
ventas/ventas.css
ventas/ventas.js

shared/base.css                 variables de diseño (colores, tipografías) comunes a las 4 páginas
shared/js/supabase-config.js    URL + anon key de Supabase (un solo lugar para actualizarlas)
shared/js/dom-utils.js          escapeHtml()
shared/js/date-utils.js         todayLocalISODate(), formatDateDisplay()
shared/js/drive-utils.js        helpers de links directos a Google Drive

sql/schema.sql                 tablas + seguridad (RLS) + bucket de imágenes en Supabase
```

No hace falta ningún paso de build: los archivos `shared/js/*.js` y los
`*.js` de cada página son módulos de JavaScript nativos del navegador
(`<script type="module">`), así que esto sigue sirviéndose tal cual en
GitHub Pages. La única diferencia con un `<script>` suelto es que los
módulos no funcionan abriendo el archivo directo con doble clic
(`file://`) por una restricción de seguridad del navegador — para
probarlo en tu máquina antes de subirlo, corré un servidor local simple
en la carpeta del proyecto, por ejemplo `python3 -m http.server` o la
extensión "Live Server" de VS Code, y abrí `http://localhost:8000/`.
Una vez publicado en GitHub Pages (que sí sirve todo por `https://`)
funciona sin nada especial.

## 1. Contenido que tenés que completar

Buscá en `index.html` los textos entre corchetes `[así]` y reemplazalos:

- Sección **Sobre mí** (`#sobre-mi`): tu presentación y la línea de tiempo de tu trayectoria.
- Número de **WhatsApp** (aparece 3 veces: mayorista, encargos, contacto) y tu **Instagram**.
- Las fotos placeholder (`<div class="photo-frame">`) — podés reemplazarlas por
  una etiqueta `<img>` directamente, o cargarlas por Supabase como el resto de
  las galerías si preferís no tocar el HTML.

## 2. Poner en marcha Supabase

1. Entrá a tu proyecto de Supabase (el mismo que usás para otros sitios).
2. Andá a **SQL Editor**, pegá el contenido de `sql/schema.sql` y ejecutalo.
   - Crea dos tablas nuevas: `rabbit3d_products` y `rabbit3d_gallery`.
   - Todas las tablas y el bucket de Storage usan el prefijo `rabbit3d_` /
     `rabbit3d-media` para no interferir con tus otros proyectos.
   - Configura las políticas de seguridad (RLS): cualquier visitante puede
     **leer** el catálogo y las galerías; solo un usuario **autenticado**
     (vos, desde el panel de admin) puede cargar o borrar contenido.
3. Andá a **Project Settings → API** y copiá:
   - `Project URL`
   - `anon public key`
4. Pegá esos dos valores en `shared/js/supabase-config.js` (`SUPABASE_URL` /
   `SUPABASE_ANON_KEY`) — es el único lugar donde hace falta ponerlos, las
   4 páginas los toman de ahí.

La `anon key` es pública (viaja en el navegador de cualquiera que visite el
sitio) — eso es normal y seguro porque las políticas de RLS solo dejan
escribir a usuarios autenticados, nunca a un visitante anónimo.

5. Dar de alta admins de Rabbit3D:
   - Si el email **ya existe** en el proyecto (por ejemplo porque lo usás en
     otra app que comparte esta misma base), no hace falta crearlo de nuevo
     desde Authentication → Users — de hecho no se puede, ya existe. Ese
     usuario ya tiene login funcionando con la contraseña que ya tiene.
   - Lo que sí hay que hacer es sumarlo a la tabla `rabbit3d_admins`, que es
     la lista de quién puede escribir contenido de Rabbit3D (estar
     autenticado en el proyecto no alcanza por sí solo, porque el Auth es
     compartido con tus otras apps). En el SQL Editor:
     ```sql
     insert into public.rabbit3d_admins (user_id, email)
     select id, email from auth.users where email = 'tu-email@ejemplo.com'
     on conflict (user_id) do nothing;
     ```
   - Si el email **no existe todavía** en el proyecto, ahí sí lo creás primero
     desde **Authentication → Users → Add user** (marcando "Auto Confirm
     User") y después corrés el mismo `insert` de arriba.
   - Para sacarle el acceso a alguien más adelante, sin tocar su usuario de
     Auth (por si lo sigue usando en otra app): `delete from
     public.rabbit3d_admins where email = '...';`

## 3. Cargar productos y fotos (panel admin)

Abrí `admin/admin.html` en el navegador (ya publicado en GitHub Pages —
ver la nota sobre módulos de JS más arriba si lo querés probar en tu
máquina primero), iniciá sesión con el usuario que creaste, y desde ahí:

- Cargás **productos** (nombre, descripción, categoría, precio, si tiene
  pack mayorista) con su foto.
- Cargás **fotos de galería** para taller o prensa (podés seleccionar varias
  a la vez), con título y fecha opcionales.
- Podés borrar cualquier producto o foto desde la tabla de abajo de cada
  formulario (borra también el archivo del Storage, no solo la fila).

Cada imagen que subís se redimensiona y se convierte a WebP **en tu propio
navegador, antes de subirse** — no hace falta editarla ni comprimirla vos
mismo, ni instalar nada. El panel muestra el peso original y el peso ya
optimizado de cada foto que elegís.

`admin/admin.html` no está enlazado desde el sitio público (no aparece en el
menú), pero igual está protegido por el login: sin una cuenta creada por vos
en Supabase, no se puede cargar ni borrar nada.

## 4. Optimización de imágenes

No tenés que hacer nada aparte: cada imagen que subís desde el panel de
admin se redimensiona y se convierte a WebP **en tu propio navegador antes
de subirse**, así ninguna foto pesada llega a la base compartida con otros
proyectos.

## 5. Publicar en GitHub Pages

1. Subí esta carpeta a un repositorio de GitHub (puede ser público o privado
   con GitHub Pro/Team; Pages gratis requiere repo público).
2. En el repo: **Settings → Pages → Source: rama `main`, carpeta `/ (root)`**.
3. GitHub te da una URL tipo `https://tu-usuario.github.io/rabbit3d/`.
4. Si más adelante comprás un dominio propio (ej. `rabbit3d.com.ar`), lo
   configurás en la misma pantalla de Pages con un archivo `CNAME`.

Como las páginas que no son `index.html` ahora viven en su propia carpeta
(`admin/admin.html`, `finanzas/finanzas.html`, `ventas/ventas.html`), sus
links cambiaron: si tenías alguno guardado como `tu-sitio/admin.html`, ahora
es `tu-sitio/admin/admin.html` (ídem finanzas y ventas).

## 6. Notas de diseño

- El motivo visual repetido ("líneas de capa") hace referencia directa a
  cómo se construye una pieza impresa en 3D: capa sobre capa. Se usa como
  separador entre secciones y en la animación del hero, donde tu logo se
  "imprime" de abajo hacia arriba.
- Paleta tomada directamente de tu logo: fondo navy casi negro, rojo (de
  las orejas/lengua/corbata) como acento principal, gris-azulado (del
  pelaje) como acento secundario, blanco para textos y detalles.
- Tipografías: **Space Grotesk** (títulos), **Inter** (texto), **IBM Plex
  Mono** (etiquetas técnicas, precios, año en la línea de tiempo) — se cargan
  desde Google Fonts, sin costo.
- La sección de **Prensa** es la que más confianza genera: no demoraría en
  cargarla apenas tengas 4-6 fotos buenas.

## 7. Ideas para más adelante (opcional)

- Un formulario de contacto propio (hoy el sitio deriva todo a WhatsApp, que
  es la opción más simple y sin backend).
- Analítica simple (Plausible o similar) para ver qué productos generan más
  clics hacia WhatsApp.
- Roles distintos dentro del panel de admin (por ejemplo, que un colaborador
  solo pueda cargar fotos de prensa y no borrar productos) — hoy cualquier
  usuario autenticado puede hacer todo.
