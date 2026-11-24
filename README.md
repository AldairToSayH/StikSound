<div align="center">

<img src="docs/assets/app-icon.svg" alt="StikSound App Icon" width="120" height="120" />

# StikSound

**Ponle sonido de hasta 5 segundos a cualquier sticker PNG o GIF animado para WhatsApp — pega tu sticker, elige un audio o link de MyInstants y pégalo directo en WhatsApp sin instalar nada extra.**

[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Chrome-25D366?style=flat-square)](#qué-necesitas-instalar)
[![Zero Deps](https://img.shields.io/badge/Dependencias-Cero%20(100%25%20Autocontenido)-0ea5e9?style=flat-square)](#cómo-funciona-en-3-pasos)
[![Privacy](https://img.shields.io/badge/Privacidad-100%25%20Local%20(Sin%20Nube)-10b981?style=flat-square)](#privacidad-y-seguridad)
[![License](https://img.shields.io/badge/License-MIT%20OR%20Apache--2.0-6366f1?style=flat-square)](LICENSE-MIT)

[**Cómo funciona (3 pasos)**](#cómo-funciona-en-3-pasos) · [**Qué puedes hacer**](#qué-puedes-hacer) · [**Extensión de Chrome**](#usar-como-extensión-de-chrome) · [**Documentación técnica**](#para-desarrolladores)

</div>

---

## ¿Para qué sirve StikSound?

Si ya tienes un sticker (o un meme en **PNG** o **GIF animado**) y quieres agregarle un sonido gracioso de **hasta 5 segundos** para subirlo en WhatsApp, **StikSound** lo hace en segundos desde una pantalla súper simple:

- **Sin programas complicados de edición de video.**
- **Sin instalar FFmpeg ni herramientas adicionales.**
- **Sin subir tus imágenes o audios a páginas externas:** todo ocurre en tu computadora o navegador.

---

## Cómo funciona en 3 pasos

1. **Pega tu sticker (`Ctrl + V` / `Cmd + V`):**
   - También puedes arrastrar o elegir archivos **PNG** (con transparencia), **GIF animado**, **WebP** o **JPG**.
   - Si tu imagen no es cuadrada, **solo mueve el mouse encima (sin hacer clic)** para encuadrar la parte exacta `1:1` que quieres mostrar.
   - Si es PNG/GIF transparente, elige abajo si quieres conservar **fondo Transparente** o usar fondo **Blanco, Negro o cualquier color**.
2. **Agrega el sonido (máximo 5 segundos):**
   - Pega directamente un enlace de **MyInstants**, o arrastra un archivo **MP3, WAV, OGG o M4A**.
   - Si el audio dura más de 5 segundos, desliza la barra inferior para escoger los mejores 5 segundos.
3. **Pégalo en WhatsApp (`➔`) o descárgalo (`⬇`):**
   - Pulsa la flecha **`➔`** para ver la vista previa y **copiarlo directo al portapapeles** en el formato más compatible: luego solo presiona `Ctrl + V` en el creador de stickers de WhatsApp.
   - O pulsa **`⬇`** si prefieres elegir el formato exacto para descargar (**MP4 compatible**, **WebM alta calidad / transparente**, **Paquete ZIP** o **WebP**).
   - ¿Quieres empezar otro? Pulsa **`✕`** arriba a la izquierda para limpiar todo al instante.

---

## Qué puedes hacer

| Función | Qué significa para ti |
| --- | --- |
| **Stickers estáticos y GIFs** | Funciona con PNG transparente, WebP, JPG y GIFs animados en bucle de hasta 5 segundos. |
| **Resolución inteligente `1:1`** | Respeta el tamaño original de tu imagen hasta un máximo de `512 × 512 px` sin deformarla ni pixelarla. |
| **Encuadre con solo pasar el mouse** | Las imágenes rectangulares se centran solas y puedes mover el recorte `1:1` moviendo el cursor encima. |
| **Transparencia a tu elección** | Conserva transparencia real (WebM) o elige fondo blanco, negro o personalizado (MP4 compatible). |
| **Enlaces de MyInstants** | Pega el link del sonido y StikSound lo descarga de forma segura para que puedas recortarlo. |
| **Copiar directo o descargar** | Flecha `➔` para copiar y pegar al instante; botón `⬇` para elegir calidad/formato al guardar. |

---

## Qué necesitas instalar

- **En Windows / macOS:** nada extra. Solo abre la aplicación **StikSound** (usa el motor gráfico nativo del sistema).
- **En Google Chrome:** puedes cargar la extensión sin instalar programas de escritorio.

### Usar como extensión de Chrome

1. Descarga o compila la carpeta de la extensión (`apps/extension/dist`).
2. Abre `chrome://extensions/` en Google Chrome y activa **Modo de desarrollador**.
3. Haz clic en **Cargar descomprimida** y selecciona `apps/extension/dist`.
4. Pulsa el ícono de **StikSound** en la barra de Chrome para abrirlo.

---

## Privacidad y seguridad

- Tus stickers y audios **nunca salen de tu equipo** ni se suben a servidores de terceros.
- El único acceso a internet ocurre cuando tú pegas explícitamente un enlace de `myinstants.com`, protegido contra enlaces maliciosos.
- Los sonidos descargados desde MyInstants pertenecen a sus respectivos autores.

---

## Para desarrolladores

- Índice técnico y especificaciones completas: [docs/README.md](docs/README.md)
- Tests TypeScript/UI: `npm install && npm test && npm run typecheck`
- Tests Rust: `cargo test --workspace --exclude stiksound-desktop`

## License

Dual-licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

at your option (`MIT OR Apache-2.0`).
