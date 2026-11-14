<p align="center">
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">
    <img src="docs/assets/brand/logo-eyes.webp" width="120" height="120" alt="Símbolo Eyes de AnyModelBot: dos ojos verticales en forma de píldora que miran a izquierda y derecha">
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/wordmark-dark.svg">
    <img src="docs/assets/brand/wordmark-light.svg" height="40" alt="AnyModelBot">
  </picture>
</h1>

<p align="center"><b>Un equipo de bots de IA en tu propia computadora. Cualquier modelo, pago por uso.</b></p>

<p align="center">
  <a href="https://anymodel.bot/es/">Sitio web</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/releases">Descargar</a> |
  <a href="./README.md">简体中文</a> |
  <a href="./README_en.md">English</a> |
  <a href="./README_ja.md">日本語</a> |
  <a href="./README_ko.md">한국어</a> |
  <a href="./README_ru.md">Русский</a> |
  Español |
  <a href="./README_pt.md">Português (Brasil)</a> |
  <a href="https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme">Modelflare</a> |
  <a href="https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme">Precios</a> |
  <a href="./docs/development_es.md">Desarrollo</a> |
  <a href="https://github.com/modelflare-ai/AnyModelBot/issues">Comentarios</a>
</p>

<div align="center">

[![Versión][release-shield]][releases-link]
[![Descargas][downloads-shield]][releases-link]
[![Estrellas][stars-shield]][stars-link]
[![Licencia][license-shield]][license-link]
[![CI][ci-shield]][ci-link]

[![Plataformas][platform-shield]][releases-link]
[![Precios][pricing-shield]][pricing-link]
[![Modelflare][modelflare-shield]][modelflare-link]
[![X][x-shield]][x-link]

</div>

<p align="center">
  <img src="docs/assets/hero/hero-demo.gif" alt="AnyModelBot en acción: iniciar sesión en Modelflare, elegir un modelo, pedirle a un bot que ordene una carpeta y aprobar que mueva un archivo" width="100%">
</p>

# 🤖 AnyModelBot

AnyModelBot es un equipo de bots de IA para Windows, macOS y Linux que se ejecuta en tu computadora. Cada bot tiene su propia personalidad, modelo predeterminado, espacio de trabajo y memoria. Puedes chatear en la app o conectar WeChat, Feishu, Telegram, Slack o Discord. Puede leer y escribir archivos, ejecutar comandos y manejar el escritorio cuando le das permiso; antes de escribir fuera de su espacio de trabajo, te pregunta.

Las conversaciones, la memoria, los archivos y las claves de API se quedan en tu dispositivo. Los modelos pueden venir de [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) (inicias sesión y pagas por uso) o de tus propias claves de API oficiales, que se envían directamente al proveedor. AnyModelBot en sí no cobra ninguna suscripción.

Listo para usar desde la instalación: las tareas en segundo plano, las reglas programadas y los asuntos que esperan tu visto bueno ya vienen integrados.

**0.1.33:** página Programado, deshacer y restaurar reglas, recuperación en un plazo de hasta doce horas, diez plantillas de bots y vista previa de archivos y sitios en el panel derecho. También mejoran los espacios de trabajo y los permisos de macOS. [Historial de cambios](./CHANGELOG_es.md#0133---2026-11-14)

📥 [Descargar](#-descargar-y-ejecutar) · 🌠 [Capturas](#-capturas-de-pantalla) · 🌟 [Funciones](#-funciones-principales) · 🆚 [Comparativa](#-anymodelbot-frente-a-grok-bot-openai-dots-y-claude-duet) · 🔐 [Privacidad](#-cómo-funciona-y-privacidad)

⭐ ¿Te gusta AnyModelBot? Dale una estrella al repositorio para seguir las nuevas versiones.

---

<a href="https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme">
  <img src="docs/assets/modelflare/modelflare-banner-en.webp" width="100%" alt="Banner de Modelflare: regístrate en Modelflare">
</a>

La forma más sencilla de obtener modelos es **[Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme)**: inicias sesión y usas los modelos, sin tener que pedir una clave aparte a cada proveedor (si prefieres ir directo a un proveedor, consulta [Cualquier modelo](#-cualquier-modelo-con-modelflare-o-con-api-oficiales)). Los modelos disponibles, los precios y las ofertas vigentes están en [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) y en la [lista de precios](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme).

**Créditos de Bot**: las cuentas nuevas reciben créditos de Bot al registrarse, y las suscripciones de Modelflare suman créditos de Bot equivalentes al 10 % del plan; consulta las condiciones vigentes en el sitio de Modelflare. Los créditos de Bot solo se pueden usar en AnyModelBot. Las solicitudes que salen de la app los usan primero, y la esquina inferior izquierda muestra cuánto te queda.

**[Regístrate en Modelflare →](https://modelflare.dev/sign-up?utm_source=anymodelbot&utm_campaign=amb_readme)** ·
[Lista de precios](https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[Documentación de la API](https://docs.modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[Centro de confianza](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) ·
[X](https://x.com/modelflare_dev)

**Cómo se usa Modelflare en AnyModelBot**

- **Inicia sesión una sola vez.** En el primer inicio se abre tu navegador para que inicies sesión en Modelflare (o te registres). Después, la app conecta este dispositivo por su cuenta, así que no hay ninguna clave que copiar, y te lleva de vuelta en cuanto apruebas. Si todavía no tienes un modelo predeterminado, la app elige uno de bajo costo que admita herramientas. ¿Lo usas en Docker o en un servidor? Inicia sesión desde el navegador de cualquier dispositivo y pega en la app el enlace de la página a la que llegues.
- **Todos los modelos, un solo selector.** Tus modelos de Modelflare aparecen automáticamente, cada uno con su longitud de contexto, sus capacidades y sus precios de referencia.
- **Paga por lo que usas.** Tu saldo y un enlace para recargar están siempre en la esquina inferior izquierda (junto con el porcentaje de créditos de Bot que te queda, si tienes), y los avisos de saldo bajo y el uso por día aparecen dentro de la app. Antes de elegir un modelo, revisa la lista de precios pública y compárala con las tarifas oficiales.
- **Transparencia sobre los límites.** Las solicitudes a los modelos pasan por Modelflare hasta el proveedor que elijas, y Modelflare guarda registros de las solicitudes. En el [Centro de confianza](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) se explica qué se guarda y durante cuánto tiempo. Todo lo demás se queda en tu dispositivo ([detalles](#-cómo-funciona-y-privacidad)).

---

# 📥 Descargar y ejecutar

Elige tu plataforma. La página de cada versión incluye todos los instaladores y un archivo `SHA256SUMS`.

| Plataforma | Arquitectura | Instalador | |
| :--- | :--- | :--- | :--- |
| ![Windows][win-badge] | x64 | `anymodel-bot-<version>-win-x64.exe` | [Descargar][releases-link] |
| ![Windows][win-badge] | arm64 | `anymodel-bot-<version>-win-arm64.exe` | [Descargar][releases-link] |
| ![macOS][mac-badge] | Apple silicon | `anymodel-bot-<version>-mac-arm64.dmg` | [Descargar][releases-link] |
| ![macOS][mac-badge] | Intel | `anymodel-bot-<version>-mac-x64.dmg` | [Descargar][releases-link] |
| ![Linux][linux-badge] | x64 | `anymodel-bot-<version>-linux-x86_64.AppImage` | [Descargar][releases-link] |
| ![Linux][linux-badge] | arm64 | `anymodel-bot-<version>-linux-arm64.AppImage` | [Descargar][releases-link] |

<p align="center">
  <img src="docs/assets/download/install-windows.gif" alt="Instalación de AnyModelBot en Windows: ejecutar el instalador, abrir la app y llegar a la pantalla de inicio de sesión de Modelflare" width="100%">
</p>

**Primer inicio.** Si Windows muestra una advertencia de seguridad, elige *Más información → Ejecutar de todas formas*. La app de macOS está firmada con Developer ID y notarizada por Apple: arrástrala a Aplicaciones, ábrela y elige Abrir si se te pide confirmar una descarga de internet. En Linux, marca el AppImage como ejecutable (`chmod +x`) y ejecútalo. Al cerrar la ventana, AnyModelBot se oculta en la bandeja del sistema; para salir, usa el menú de la bandeja o Ajustes.

**Verifica una descarga.**

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

En macOS usa `shasum -a 256 <file>`; en PowerShell de Windows, `Get-FileHash <file>`. Compara el resultado con la línea correspondiente de `SHA256SUMS`.

**Ejecútalo en Docker en un NAS o un servidor** (la imagen sirve tanto para x64 como para arm64)

```bash
docker run -d --name amb -p 3600:3600 -v amb-data:/data ghcr.io/modelflare-ai/anymodel-bot
docker exec amb cat /data/ui-token   # luego abre http://<host>:3600/?token=<token>
```

No expongas el puerto 3600 directamente a internet.

**Ejecutar desde el código fuente**

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup      # descarga y compila el gateway integrado
npm start          # abre la consola local en http://127.0.0.1:3600/
```

Requisitos para compilar desde el código fuente: Node.js 22.13+ y Go 1.26.8+. Para compilar tú mismo la imagen de Docker, consulta la [guía de desarrollo](./docs/development_es.md).

# 🌠 Capturas de pantalla

Estas capturas muestran la interfaz en chino simplificado. La app también está disponible en inglés, japonés, coreano, ruso, español y portugués (Brasil); puedes cambiar el idioma en Ajustes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/chat-dark.webp">
  <img src="docs/assets/screenshots/chat-light.webp" alt="Pantalla de chat: una respuesta con una lista en Markdown y un bloque de código, el botón del modelo en el cuadro de mensaje y la lista de bots a la izquierda" width="100%">
</picture>

<p align="center"><i>Chatea con un bot. Las respuestas muestran Markdown y código, y el cuadro de mensaje indica qué modelo se está usando.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/agent-dark.webp">
  <img src="docs/assets/screenshots/agent-light.webp" alt="Pantalla del bot: lista paso a paso de la actividad en una tarea con archivos y una tarjeta de aprobación que pide permiso para escribir fuera del espacio de trabajo" width="100%">
</picture>

<p align="center"><i>Puedes ver paso a paso lo que hace el bot. Todo lo que queda fuera del espacio de trabajo espera tu aprobación.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/models-dark.webp">
  <img src="docs/assets/screenshots/models-light.webp" alt="Selector de modelos: lista de modelos de Modelflare con búsqueda, longitud de contexto, etiquetas de capacidades y precios de referencia" width="100%">
</picture>

<p align="center"><i>Elige cualquier modelo de Modelflare en cada conversación. Junto a cada uno aparecen su longitud de contexto, sus capacidades y sus precios de referencia.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/memory-dark.webp">
  <img src="docs/assets/screenshots/memory-light.webp" alt="Panel de información con las entradas de memoria de un bot, los canales conectados y las sesiones recientes" width="100%">
</picture>

<p align="center"><i>La memoria, los canales y las sesiones de cada bot, en un solo panel.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/modelflare-dark.webp">
  <img src="docs/assets/screenshots/modelflare-light.webp" alt="Ajustes, pestaña Modelflare con el cuadro de uso abierto: uso diario de los últimos 7 días, la fila del modelo predeterminado debajo y el saldo en el botón de la cuenta" width="100%">
</picture>

<p align="center"><i>Tu cuenta de Modelflare dentro de la app: saldo, uso y valores predeterminados.</i></p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/bots-dark.webp">
  <img src="docs/assets/screenshots/bots-light.webp" alt="Seis personajes de AnyModelBot en fila, cada uno con su propio color" width="100%">
</picture>

<p align="center"><i>Seis personajes para distinguir a tus bots. Sus ojos siguen el puntero.</i></p>

# 🌟 Funciones principales

## 🤖 Bots que hacen el trabajo

Un bot es más que una ventana de chat: tiene una personalidad, un modelo predeterminado, su propio espacio de trabajo y su propia memoria.

- **Todos los que necesites**, cada uno con su propia personalidad, modelo, espacio de trabajo y avatar.
- **Tú defines cada bot.** Una personalidad es solo texto, y las plantillas son apenas un punto de partida. Los seis avatares cambian el aspecto de un bot, no lo que puede hacer.
- **Trabajo real con archivos.** Los bots leen y escriben archivos, ejecutan comandos en un sandbox y te devuelven los resultados al chat como archivos.
- **Tres modos de permisos por bot.** *Solo lectura*, *Escritura en el espacio de trabajo* (el predeterminado: escribe dentro de la carpeta del propio bot y pregunta antes de escribir fuera de su espacio de trabajo) y *Acceso total* (sin sandbox; incluso con acceso total, pregunta antes de eliminar una carpeta entera).
- **Importa habilidades.** En **Ajustes del bot → Habilidades**, importa un ZIP que contenga `SKILL.md` (una habilidad por ZIP, hasta 20 MB), revisa la vista previa y agrégala. Puedes ver, activar, desactivar o eliminar habilidades; si importas otra vez una con el mismo nombre, se te pide confirmar el reemplazo. Los cambios se aplican cuando termina el trabajo en curso. [Guía de habilidades](./docs/skills_es.md).
- **Tarjetas de aprobación, no sorpresas.** Las acciones que escriben fuera del espacio de trabajo se detienen y esperan tu respuesta.
- **Aviso después de un reinicio.** Si un mensaje seguía en curso cuando la app se cerró o falló, en el siguiente inicio queda marcado en su conversación para que puedas enviarlo de nuevo; nada se vuelve a ejecutar por su cuenta.
- **Chats grupales.** Crea un grupo y agrega algunos bots. Responde el bot al que mencionas con @; si no mencionas a ninguno, continúa el último que respondió. Los bots también pueden mencionar con @ a otro miembro para pasarle el relevo. Cada bot conserva su propio modelo, espacio de trabajo y memoria, y los costos se registran por bot.
- **Búsqueda en el historial de chats.** Desde la barra lateral, busca en todos los mensajes guardados en tu dispositivo, filtra por bot, conversación, canal o fecha, y salta al mensaje original. `Ctrl/Cmd+Shift+F` abre la búsqueda global; `Ctrl/Cmd+F` busca en el chat actual. Las búsquedas no llaman a ningún modelo. Antes de que escribas, el cuadro de búsqueda muestra los chats recientes por fecha.
- **Los comandos con barra**, como `/model` y `/reset`, funcionan en la app y en todos los canales de chat. En un canal de chat, `/bot` cambia a otro bot.

<p align="center">
  <img src="docs/assets/features/agent-files.gif" alt="Un bot ordena una carpeta desordenada: lista los archivos, propone un plan y una tarjeta de aprobación pregunta antes de mover archivos fuera de su espacio de trabajo" width="100%">
</p>

## 🧩 Bots listos para usar

Si no quieres escribir una personalidad, usa un bot listo para usar de Descubrir. Cada uno tiene su propia vista. Al abrir uno ves un ejemplo, y solo se instala cuando envías tu primer mensaje.

Los bots oficiales incluyen en el instalador sus interfaces, ejemplos, personalidades y habilidades. La primera vista previa y la instalación no requieren descargar paquetes de bots. Las actualizaciones llegan con las versiones de la app y conservan los datos de los proyectos existentes. Las llamadas a los modelos y la investigación en línea siguen necesitando conexión a internet. Cada bot es un espacio de trabajo de escritorio: tu trabajo aparece en una lista a la izquierda y el contenido a la derecha; Nuevo abre un breve formulario guiado, la barra superior cambia al chat completo y el cuadro de entrada incluye el selector de modelos.

- **Análisis de empresas:** investigación de empresas en tu computadora, con resúmenes que citan sus fuentes e informes en PDF.
- **PPT Master:** convierte documentos o temas en diapositivas editables, o edita las presentaciones que ya tienes.
- **Estudio de cine:** videos cortos y series: guion, storyboard, voz, edición y montaje final.
- **Acciones de EE. UU.:** investiga empresas que cotizan en EE. UU. a partir de sus documentos ante la SEC, con cada cifra rastreable hasta su origen.

Estudio de cine requiere AnyModelBot 0.1.23 o posterior, además de Python 3.10+ y FFmpeg (con ffprobe) en tu dispositivo. Las imágenes y los videos con IA usan Modelflare y se cobran según el uso; los proyectos y los archivos multimedia se quedan en tu dispositivo.

Consulta la [página de bots de nuestro sitio web](https://anymodel.bot/es/bots) para más detalles.

## ⏳ Trabaja en segundo plano y solo te busca cuando hace falta

- **Tareas en segundo plano.** Para trabajos que llevan un rato (una investigación, un informe, ordenar archivos), o cuando le dices “hazlo en segundo plano”, el bot inicia una tarea en segundo plano y tú sigues chateando. El resultado vuelve a la conversación desde la que se pidió.
- **Seguimiento.** Cita el resultado en WeChat, o respóndelo en Feishu, para seguir hablando con esa tarea.
- **Reglas.** “Todos los días a las 8 de la mañana, revisa el precio de X y avísame si baja de 200” se convierte en una regla que revisa según lo programado y solo te avisa cuando hay algo importante. Para ver primero cómo se comporta, di “observa primero”: registra lo que habría dicho, sin enviar nada ni modificar ningún archivo. Cuando te parezca bien, cámbiala al modo de actuar.
- **Te necesita.** Todo lo que cualquier bot espera de ti, ya sea una respuesta, una aprobación o un reintento, está reunido en una sola fila de la barra lateral que solo aparece cuando algo te necesita. El grupo Tareas del panel de información muestra las tareas y reglas del bot, con cada paso a la vista.
- **Silencioso por defecto.** Solo te llegan resultados, decisiones y fallos, nunca el progreso. El horario de silencio va de 22:00 a 08:00, y los mensajes no solicitados tienen un límite diario (3 en WeChat, 5 en los demás canales); el resto se agrupa en uno solo.
- **Presupuestos.** Cada tarea y cada regla tienen un presupuesto (1 dólar estadounidense por tarea; 0.10 por ejecución de una regla y 3 al mes), y cuando se agota, el trabajo se detiene y te pregunta. Puedes cambiarlos en los detalles de la tarea y en el editor de reglas.
- **Pausa cuando quieras.** Un solo interruptor en Ajustes del bot › Mensajes proactivos pausa el trabajo en segundo plano; el chat sigue funcionando.
- **Se limpia solo.** Las tareas y los registros de ejecución se guardan 30 días. Una carpeta de tarea que lleva 30 días sin usarse se elimina sin preguntar; los detalles de la tarea muestran la fecha, y Conservar evita que se borre. Los registros de ejecución se exportan como Markdown.

El entorno de ejecución está construido sobre [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), y el diseño se inspira en el [prototipo de superagente](https://github.com/deepseek-ai/dsh-superagent-prototype) de DeepSeek. La historia completa, en chino: [AnyModelBot 超级智能体](./docs/blog/superagent.md).

## 🖥️ Maneja tu computadora y crea imágenes y video

- **El uso de la computadora** funciona con el [Cua Driver](https://github.com/trycua/cua) integrado. De forma predeterminada, las acciones se ejecutan automáticamente. Si cambias un bot a *preguntar antes de cambiar la pantalla*, cada clic y cada pulsación de tecla esperan tu confirmación. Leer la pantalla nunca requiere aprobación. En macOS, el uso de la computadora es una función beta: los permisos de Accesibilidad y Grabación de pantalla se solicitan solo cuando un bot los necesita por primera vez, y el chat explica cuál falta.
- **La generación de imágenes y video** empieza de inmediato y toma la interpretación más razonable de una petición poco precisa. Solo pregunta antes cuando el costo estimado supera los 0.50 dólares estadounidenses, para que veas el modelo y el prompt y puedas cambiar de modelo en el momento. Si quieres que te pregunte siempre, actívalo en los ajustes del bot.

<p align="center">
  <img src="docs/assets/features/computer-use.gif" alt="Un bot abre el Bloc de notas, escribe una nota corta y la guarda, mientras una tarjeta de aprobación pregunta antes de cada clic y cada pulsación de tecla" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/media-generation.gif" alt="Un bot pregunta qué modelo usar para una imagen, el usuario confirma y la imagen terminada llega al chat como archivo y se abre en un visor" width="100%">
</p>

## 🌐 Cualquier modelo, con Modelflare o con API oficiales

- **Inicia sesión una sola vez** y tus modelos de Modelflare aparecen automáticamente.
- **O usa tus propias claves de API oficiales.** Se admiten OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax y Mistral. Las claves se quedan en tu dispositivo, las solicitudes a los modelos van directamente al proveedor sin pasar por Modelflare, y es el proveedor quien te factura. Por ahora, la generación de imágenes y video solo está disponible con Modelflare.
- **Un solo selector para todo.** GPT, Claude, Gemini, Grok, DeepSeek, Kimi, GLM y más, cada uno con su longitud de contexto, sus etiquetas de capacidades y un precio de referencia.
- **Cambia de modelo en cada conversación** o define uno predeterminado por bot. Las tareas internas en segundo plano, como ordenar la memoria o los traspasos de contexto, pueden usar un modelo propio aparte.
- **Tres dominios de API.** Elige `modelflare.dev`, `origin.modelflare.dev` o `cf.modelflare.dev` y compara sus tiempos de respuesta en Ajustes; AnyModelBot nunca cambia de dominio por su cuenta.
- **Pago por uso.** El saldo de la billetera, los avisos de saldo bajo, el uso diario y las claves con presupuesto por bot vienen integrados. AnyModelBot en sí no cobra ninguna suscripción.

<p align="center">
  <img src="docs/assets/features/first-run.gif" alt="Primer inicio: hacer clic en Iniciar sesión en Modelflare, aprobar en el navegador, volver a la app con los modelos ya listados y enviar un primer mensaje" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/model-switch.gif" alt="Abrir el selector de modelos, buscar un modelo, ver su longitud de contexto y su precio de referencia, y cambiar la conversación a ese modelo" width="100%">
</p>

## 🧠 Memoria y acceso desde cualquier lugar

- **Memoria que perdura.** Cada bot, grupo y equipo tiene su propia memoria, guardada en Markdown y por separado. Lo que parece una contraseña o una clave no se guarda.
- **Los chats largos siguen siendo manejables.** Un gestor de contexto compacta la conversación o empieza un nuevo tramo con un resumen de traspaso antes de que se llene la ventana de contexto.
- **Cuentas compartidas por todos los bots.** Agrega una sola vez tus cuentas de chat de WeChat, Feishu, Telegram, Slack y Discord en Ajustes › Canales de chat. Todos los bots las comparten, y cada canal puede tener varias cuentas con alias. Envía una vez `/bot nombre` en una app de chat para hablar con otro bot.
- **Conectar apps.** Conectar apps, en el menú del avatar, incluye conectores para Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian y Canva, y puedes agregar conectores MCP personalizados (servidores remotos o comandos locales). Conecta una vez y todos los bots pueden usarlo de forma predeterminada; puedes restringirlo por bot y por herramienta. Las herramientas de solo lectura se ejecutan de inmediato, las escrituras te preguntan primero, y las eliminaciones o cualquier cosa que se envíe a otras personas siempre preguntan.
- **WeChat y Feishu.** Escanea un código QR para conectar WeChat, o conecta un bot de Feishu con tarjetas de respuesta que se actualizan en tiempo real. WeChat también admite imágenes y archivos.
- **Telegram, Slack y Discord.** Pega un token en Ajustes › Canales de chat. No hace falta una dirección pública. Las respuestas aparecen a medida que se escriben, y las imágenes y los archivos funcionan en ambos sentidos. Por ahora solo funcionan los mensajes directos, y las aprobaciones y las preguntas se responden por texto.
- **Cuatro formas de ejecutarlo.** App de escritorio, línea de comandos, Docker o la consola web local en `127.0.0.1:3600`.

<p align="center">
  <img src="docs/assets/features/memory.gif" alt="Pedirle a un bot que recuerde una preferencia, abrir el panel de información para ver la nueva entrada de memoria y luego iniciar un chat nuevo en el que el bot la usa" width="100%">
</p>

<p align="center">
  <img src="docs/assets/features/channels-wechat.gif" alt="Escanear un código QR para conectar WeChat, enviar una pregunta desde el teléfono y ver cómo el bot responde en el teléfono mientras la conversación aparece en Sesiones recientes en la app de escritorio" width="100%">
</p>

## 🔒 Tus datos en local, y una interfaz agradable

- **Tus datos se quedan contigo.** Las conversaciones, la memoria, los archivos y las claves de API se guardan en tu dispositivo. La consola local solo escucha en `127.0.0.1`, y la app de escritorio genera un token de acceso nuevo en cada inicio.
- **Responde ante ti.** De forma predeterminada, un bot solo responde a su propietario (la cuenta de WeChat que escaneó el código QR; en Feishu, Telegram, Slack y Discord, la primera persona que le escribe después de conectarlo, es decir, tú) y a las personas que autorices. Cualquier otra persona recibe un aviso de una línea y no se llama a ningún modelo; puedes darle acceso desde el panel de información o respondiendo `yes <code>` en el chat.
- **Las respuestas no se pierden.** Cada respuesta se guarda localmente antes de enviarse; los errores de red se reintentan, el envío se reanuda después de un reinicio y, si la ventana de 24 horas de WeChat ya se cerró, la respuesta espera y llega junto con tu siguiente mensaje.
- **Telemetría desactivada.** La telemetría del controlador de uso de la computadora incluido está desactivada, y el gateway integrado se ejecuta con la actualización automática deshabilitada.
- **Actualizaciones desde la app.** A partir de la 0.1.29, las apps de escritorio instaladas activan de forma predeterminada Ajustes → General → Descargar actualizaciones automáticamente. Las versiones nuevas se descargan en segundo plano y, cuando están listas, ofrecen Reiniciar y actualizar. La instalación requiere tu clic y que no haya tareas en ejecución; desactiva la opción si prefieres descargar manualmente. Quienes tengan la 0.1.28 o una anterior deben instalar manualmente la 0.1.29 o una posterior una vez. Las instalaciones con Docker o desde el código fuente se siguen actualizando manualmente. A partir de la 0.1.30, el primer inicio después de una actualización muestra qué cambió, el aviso de nueva versión muestra las notas antes de actualizar y el registro de cambios está siempre en Ajustes → Acerca de.
- **Claro, oscuro o según el sistema.** Seis personajes de bot, y sus ojos siguen tu puntero.
- **Bandeja del sistema e inicio automático.** Cierra la ventana para ocultarla en la bandeja; el inicio automático está disponible en macOS y Windows.

<p align="center">
  <img src="docs/assets/features/characters-eyes.gif" alt="Seis personajes de AnyModelBot en fila; sus ojos siguen el puntero mientras pasa por encima de ellos" width="100%">
</p>

> [!NOTE]
> Las funciones dependen del modelo que elijas, de tu sistema operativo y de los permisos que concedas. El uso de la computadora requiere una sesión de escritorio, y en macOS está en beta. Las solicitudes a los modelos van al proveedor que elijas (directamente con tu propia clave de API oficial; si no, a través de Modelflare); consulta [Cómo funciona y privacidad](#-cómo-funciona-y-privacidad).

# 🆚 AnyModelBot frente a Grok Bot, OpenAI dots y Claude Duet

En la segunda mitad de 2026 se lanzaron, uno tras otro, [Grok Bot](https://x.ai/bot) de xAI, [dots](https://openai.com/index/introducing-dots/) de OpenAI y Claude Duet de Anthropic. También trabajan para ti en segundo plano y te consultan cuando la decisión es tuya. AnyModelBot hace el mismo tipo de trabajo, pero de otra manera: es de código abierto, se ejecuta en tu propio dispositivo y funciona con una amplia variedad de modelos.

| | AnyModelBot | Grok Bot | OpenAI dots | Claude Duet |
| :--- | :--- | :--- | :--- | :--- |
| Código abierto | ✅ MIT | — | — | — |
| Dónde se ejecuta | Tu propia computadora o servidor | Computadora en la nube de xAI | Computadora en la nube de OpenAI | Nube de Anthropic |
| Modelos | GPT, Claude, Gemini, Grok y más (con Modelflare o API oficiales) | Principalmente los modelos Grok de xAI | Modelos de OpenAI | Claude (Opus 5.5) |
| Costo | App gratis, modelos cobrados por token | Suscripción | Suscripción a ChatGPT Pro / Business Premium | Suscripción a Claude Pro / Max |
| Dónde lo usas | App de escritorio (Windows, macOS, Linux), Docker, WeChat, Feishu, Telegram, Slack, Discord | App de escritorio, iPhone | ChatGPT, Slack, Teams | iOS, Android, claude.ai |
| Disponibilidad | Descárgalo ya | Beta | Mercados seleccionados | Vista previa de investigación, lista de espera en EE. UU. |

AnyModelBot también trabaja en segundo plano: una tarea que le encargas puede terminar en segundo plano y enviar el resultado a tu app de chat, y todo lo que necesite tu aprobación o tu respuesta aparece en “Te necesita”, en la barra lateral. Cada paso que da un bot está a la vista, y antes de hacer cualquier cosa fuera de su espacio de trabajo te pregunta.

> [!NOTE]
> Los datos de los otros productos provienen de información pública disponible en octubre de 2026 y pueden haber cambiado; consulta la información oficial de cada proveedor. Grok Bot, dots y Claude Duet son productos y marcas comerciales de xAI, OpenAI y Anthropic, respectivamente. AnyModelBot no está afiliado a ellos.

# 🔐 Cómo funciona y privacidad

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/data-flow-dark.svg">
  <img src="docs/assets/diagrams/data-flow-light.svg" alt="Flujo de datos: las conversaciones, la memoria, los archivos y las claves se quedan en tu dispositivo; las solicitudes a los modelos pasan por Modelflare hasta el proveedor del modelo; los mensajes de los canales de chat pasan por esas plataformas, y los bots leen y escriben en las cuentas de Notion y Feishu que autorices" width="100%">
</picture>

| Se queda en tu dispositivo | Sale de tu dispositivo |
| :--- | :--- |
| Conversaciones y sesiones (base de datos SQLite local) | Los prompts, archivos y resultados de herramientas que un modelo necesita para responder, enviados al proveedor que elegiste (directamente con tu propia clave de API oficial; si no, a través de Modelflare) |
| Memoria (archivos Markdown) | Capturas de pantalla, cuando le pides a un bot que mire tu pantalla con el uso de la computadora |
| Archivos del espacio de trabajo de cada bot | Los mensajes que intercambias por los canales de chat, que pasan por esas plataformas |
| Tu clave de API y tus tokens de inicio de sesión | Tu inicio de sesión con Modelflare, que ocurre en modelflare.dev |
| Conectar apps | Después de conectar apps (Feishu, Notion, GitHub, etc.) o de agregar un conector MCP personalizado, los bots leen y escriben su contenido, y lo que leen también se incluye en las solicitudes a los modelos |

Modelflare guarda registros de las solicitudes; su [Centro de confianza](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) explica qué se guarda y durante cuánto tiempo. No afirmamos que tus datos estén libres de todo riesgo: todo lo que envías a un modelo sale de tu dispositivo. El inventario completo está en [docs/privacy_es.md](./docs/privacy_es.md).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="Arquitectura: el shell de Electron, la línea de comandos o Docker inician un backend de Node.js y TypeScript con una interfaz en Preact, SQLite, el entorno de ejecución de agentes DSH y los adaptadores de canales, que llaman al gateway magpie integrado, que a su vez llama a Modelflare" width="100%">
</picture>

| Capa | Tecnología |
| :--- | :--- |
| Interfaz | Preact + htm, sin paso de compilación |
| Backend | Node.js 22.13+, TypeScript, `node:sqlite` |
| Shell de escritorio | Electron, con bandeja del sistema |
| Gateway de modelos | [magpie](https://github.com/yetone/magpie) (Go, MIT), integrado e iniciado por la app |
| Entorno de ejecución de agentes | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT), en un proceso aparte |
| Uso de la computadora | [Cua Driver](https://github.com/trycua/cua), integrado |
| Canales | Feishu (conexión persistente + tarjetas en tiempo real), WeChat (iLink), Telegram (long polling), Slack (Socket Mode), Discord (Gateway) |
| Conectar apps | Conectores integrados: Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva; MCP personalizado: Streamable HTTP (compatible con SSE), comandos locales |
| Pruebas y CI | Vitest, GitHub Actions |

# 📝 Hoja de ruta

Direcciones que estamos explorando. No son promesas, y el orden no es un calendario. Para ver qué cambió en cada versión, consulta el [registro de cambios](./CHANGELOG_es.md).

- [x] **Tareas programadas**: que un bot ejecute trabajos según un horario (ya disponible como reglas, ver más arriba).
- [x] **Chats grupales en la app**: crea un grupo en la app y chatea con varios bots a la vez.
- [ ] **Chats grupales en los canales de chat**: por ahora, los canales de chat solo manejan conversaciones uno a uno.
- [x] **Interfaz multilingüe**: la app está disponible en chino simplificado, inglés, japonés, coreano, ruso, español y portugués (Brasil); puedes cambiar el idioma en Ajustes.
- [ ] **Uso de la computadora en macOS**: verificar el modo directo en más computadoras reales y sacarlo de la beta.
- [ ] **Correo, calendario y activación por eventos**: conectar cuentas de correo y calendario, y permitir que las reglas se ejecuten en cuanto algo ocurre (un mensaje de cierta persona, una reunión a punto de empezar), no solo según un horario. Las ejecuciones activadas por contenido externo reciben menos permisos, para que un texto escrito por otra persona no pueda darle órdenes a tu bot.
- [ ] **Alojamiento siempre activo, copias de seguridad y migración**: las reglas no se ejecutan mientras tu computadora está apagada. Queremos que cualquiera pueda desplegarlo en su propio servidor con un clic, trasladar allí sus chats, su memoria y sus cuentas, y hacer y restaurar copias de seguridad.
- [ ] **Agregar tus propios servidores MCP**: hoy solo puedes usar las herramientas y cuentas integradas. Abrir esto te permitirá conectar tú mismo servicios como GitHub y Linear.
- [ ] **Bots que trabajan juntos**: que un bot le pase trabajo a otro, por ejemplo, para redactar y revisar con modelos distintos, con los costos registrados por separado.
- [ ] **Transcripción de mensajes de voz**: hoy los bots no pueden escuchar los mensajes de voz de Telegram, y en WeChat dependen de la transcripción de la propia plataforma.
- [ ] **Una app móvil independiente**: hoy llegas a tus bots desde WeChat, Feishu, Telegram, Slack o Discord.

¿Tienes otra idea? Abre un [issue](https://github.com/modelflare-ai/AnyModelBot/issues) o inicia una [discusión](https://github.com/modelflare-ai/AnyModelBot/discussions). Lo que decidamos abordar se sigue con la etiqueta [`roadmap`](https://github.com/modelflare-ai/AnyModelBot/labels/roadmap).

# 🤝 Cómo contribuir

Los reportes de errores, las correcciones, la documentación y las ideas son bienvenidos.

1. Primero revisa los [issues](https://github.com/modelflare-ai/AnyModelBot/issues) y las [discusiones](https://github.com/modelflare-ai/AnyModelBot/discussions) existentes. Los issues con la etiqueta [`good first issue`](https://github.com/modelflare-ai/AnyModelBot/labels/good%20first%20issue) son un buen punto de partida.
2. Haz un fork del repositorio y crea una rama a partir de `master`.
3. Ejecútalo localmente y haz tu cambio:

   ```bash
   npm install
   npm run setup          # descarga y compila el gateway integrado
   npm run electron:dev   # app de escritorio en modo de desarrollo
   npm run typecheck && npm test
   ```

4. Abre un pull request contra `master` y describe qué cambió y por qué. Para cualquier cambio mayor que una corrección pequeña, abre primero un issue para que acordemos el enfoque.

Lee la [guía de contribución](./CONTRIBUTING_es.md) completa. Para reportar un problema de seguridad, sigue la [política de seguridad](./SECURITY_es.md) en lugar de abrir un issue público.

# 🔗 Proyectos relacionados

- [Modelflare](https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme): el gateway de API de IA que proporciona los modelos de AnyModelBot.
- [magpie](https://github.com/yetone/magpie): el gateway en Go incluido en la app (MIT).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): el entorno de ejecución de agentes (MIT).
- [Cua](https://github.com/trycua/cua): el controlador de uso de la computadora.
- [kimi-computer-use](https://github.com/songkeys/kimi-computer-use): el puente de uso de la computadora para macOS.
- [openclaw-weixin](https://github.com/Tencent/openclaw-weixin): el canal de WeChat a partir del cual hicimos nuestra adaptación (MIT).
- [DS Bot](https://github.com/Fei2411/DS-Bot): la referencia de diseño de nuestra memoria y nuestro gestor de contexto (Apache-2.0).

Licencias y avisos completos: [THIRD_PARTY_NOTICES_es.md](./THIRD_PARTY_NOTICES_es.md).

# 💬 Comunidad

- **Preguntas e ideas:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Errores y solicitudes de funciones:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)
- **Correo:** [support@anymodel.bot](mailto:support@anymodel.bot)
- **Noticias de Modelflare:** [@modelflare_dev en X](https://x.com/modelflare_dev)

# 🚀 Colaboradores

<a href="https://github.com/modelflare-ai/AnyModelBot/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=modelflare-ai/AnyModelBot" alt="Colaboradores de AnyModelBot" />
</a>

# ⭐️ Historial de estrellas

<a href="https://www.star-history.com/#modelflare-ai/AnyModelBot&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" />
    <img alt="Gráfico del historial de estrellas de AnyModelBot en GitHub" src="https://api.star-history.com/svg?repos=modelflare-ai/AnyModelBot&type=Date" width="100%" />
  </picture>
</a>

# 📜 Licencia

AnyModelBot se publica bajo la [licencia MIT](./LICENSE). El software de terceros incluido conserva sus propias licencias; consulta [THIRD_PARTY_NOTICES_es.md](./THIRD_PARTY_NOTICES_es.md) y la carpeta [`LICENSES/`](./LICENSES).

<!-- link & badge references -->
[release-shield]: https://img.shields.io/github/v/release/modelflare-ai/AnyModelBot?include_prereleases&label=release&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iOTQiIGhlaWdodD0iODIiIHJ4PSIzNiIgZmlsbD0iI2Q3ZmYwMCIvPjxyZWN0IHg9IjI5IiB5PSIzNiIgd2lkdGg9IjEzIiBoZWlnaHQ9IjI4IiByeD0iNi41IiBmaWxsPSIjMTYxYTAwIi8+PHJlY3QgeD0iNTgiIHk9IjM2IiB3aWR0aD0iMTMiIGhlaWdodD0iMjgiIHJ4PSI2LjUiIGZpbGw9IiMxNjFhMDAiLz48L3N2Zz4=&style=flat-square&labelColor=161a00&color=d7ff00
[downloads-shield]: https://img.shields.io/github/downloads/modelflare-ai/AnyModelBot/total?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[stars-shield]: https://img.shields.io/github/stars/modelflare-ai/AnyModelBot?logo=github&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[license-shield]: https://img.shields.io/github/license/modelflare-ai/AnyModelBot?logo=opensourceinitiative&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[ci-shield]: https://img.shields.io/github/actions/workflow/status/modelflare-ai/AnyModelBot/ci.yml?branch=master&label=CI&logo=githubactions&logoColor=d7ff00&style=flat-square&labelColor=161a00&color=d7ff00
[platform-shield]: https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-d7ff00?style=flat-square&labelColor=161a00
[pricing-shield]: https://img.shields.io/badge/pricing-pay--as--you--go-d7ff00?style=flat-square&labelColor=161a00
[modelflare-shield]: https://img.shields.io/badge/Modelflare-modelflare.dev-d7ff00?style=flat-square&labelColor=161a00
[x-shield]: https://img.shields.io/badge/X-@modelflare__dev-d7ff00?style=flat-square&labelColor=161a00&logo=x&logoColor=d7ff00
[win-badge]: https://img.shields.io/badge/Windows-161a00?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2Q3ZmYwMCI+PHJlY3QgeD0iMiIgeT0iMyIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48cmVjdCB4PSIxMi41IiB5PSIzIiB3aWR0aD0iOS41IiBoZWlnaHQ9IjguNSIvPjxyZWN0IHg9IjIiIHk9IjEyLjUiIHdpZHRoPSI5LjUiIGhlaWdodD0iOC41Ii8+PHJlY3QgeD0iMTIuNSIgeT0iMTIuNSIgd2lkdGg9IjkuNSIgaGVpZ2h0PSI4LjUiLz48L3N2Zz4=
[mac-badge]: https://img.shields.io/badge/macOS-161a00?style=for-the-badge&logo=apple&logoColor=d7ff00
[linux-badge]: https://img.shields.io/badge/Linux-161a00?style=for-the-badge&logo=linux&logoColor=d7ff00

[releases-link]: https://github.com/modelflare-ai/AnyModelBot/releases
[stars-link]: https://github.com/modelflare-ai/AnyModelBot/stargazers
[license-link]: https://github.com/modelflare-ai/AnyModelBot/blob/master/LICENSE
[ci-link]: https://github.com/modelflare-ai/AnyModelBot/actions/workflows/ci.yml
[pricing-link]: https://modelflare.dev/pricing?utm_source=anymodelbot&utm_campaign=amb_readme
[modelflare-link]: https://modelflare.dev/?utm_source=anymodelbot&utm_campaign=amb_readme
[x-link]: https://x.com/modelflare_dev
