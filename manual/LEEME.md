# Manual de uso — cómo se genera

El PDF (`Manual de uso - JxR Comando Territorial.pdf`, en la raíz) se arma en cuatro pasos.
Todos necesitan el **servidor de desarrollo corriendo** en `localhost:3400` y un usuario
del sistema con sesión válida (los scripts crean y usan uno propio).

1. **Capturar** — `node manual/capturar.mjs`. Abre Chrome headless, entra al sistema y
   fotografía todo: el mapa y sus siete vistas, la ficha del circuito, Elena, estrategia,
   búnker, la ficha impresa y las pantallas de teléfono. Quedan en `manual/capturas/`
   (no se versiona).

   Dos cosas que el script cuida y conviene no romper:
   - **Modo claro.** El tema vive en `localStorage` bajo `jxr:tema` y el layout lo aplica
     antes del primer paint, así que se escribe ANTES de cargar las pantallas y se verifica
     que la clase `.claro` esté puesta. Tocar el botón del header no alcanza: la primera
     captura saldría oscura y el mapa tardaría en cambiar de estilo base.
   - **Espera por dato real,** no por tiempo fijo: cada paso aguarda a que el número o el
     texto esperado esté en pantalla, así ninguna captura sale a medio cargar.

2. **Optimizar** — `node manual/optimizar.mjs` reduce las capturas a ~1.500 px y las pasa a
   JPEG en `manual/img/` (de 19 MB a 3,5 MB). Ahí también se define el recorte de las que
   tienen espacio vacío al pie.

3. **Verificar** — `node manual/verificar.mjs` mide, hoja por hoja, si el contenido se pasa
   del área útil. Cada hoja tiene alto fijo con recorte, así que **un desborde se comería el
   texto en silencio**: este paso tiene que dar «ninguna hoja se desborda» antes de generar.
   `node manual/previsualizar.mjs` rinde cada hoja como PNG en `manual/previa/` para revisarla.

4. **Generar** — `node manual/generar-pdf.mjs` produce el PDF en A4, con Poppins y los
   colores de la marca.

El contenido vive en `manual/manual.html` y el diseño en `manual/estilos.css`.
Si cambia una pantalla del sistema, alcanza con recapturar esa parte y regenerar.
