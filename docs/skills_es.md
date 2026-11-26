# Importar y administrar habilidades

[简体中文](./skills.md) | [繁體中文（台灣）](./skills_zh-TW.md) | [English](./skills_en.md) | [日本語](./skills_ja.md) | [한국어](./skills_ko.md) | [Русский](./skills_ru.md) | Español | [Português (Brasil)](./skills_pt.md) | [Türkçe](./skills_tr.md)

A partir de AnyModelBot 0.1.24, puedes agregar a un bot flujos de trabajo que ya tengas, en forma de paquetes de habilidades ZIP, para tareas como informes semanales, procesamiento de documentos o investigación.

## Importar

1. Abre los ajustes del bot de destino, busca Habilidades y haz clic en Importar ZIP.
2. Selecciona un ZIP local y revisa su nombre, su descripción y el número de archivos. Expande las instrucciones para leerlas completas.
3. Haz clic en Agregar habilidad. El bot puede cargarla cuando una tarea relacionada la necesite.

Cada ZIP contiene una habilidad. `SKILL.md` puede estar en la raíz del ZIP o dentro de una carpeta contenedora. Se conservan los archivos de apoyo, como `scripts/`, `references/` y `assets/`. La importación no se conecta con GitHub ni ejecuta automáticamente scripts de instalación.

`SKILL.md` necesita un encabezado YAML (frontmatter) y un cuerpo con las instrucciones, por ejemplo:

```markdown
---
name: weekly-report
description: Redacta informes semanales a partir de las notas de trabajo del usuario.
---

Organiza el trabajo terminado, los problemas y los planes para la próxima semana, y luego usa el formato que pida el usuario.
```

Los nombres usan letras minúsculas del alfabeto inglés, dígitos y guiones simples, con un máximo de 64 caracteres. Los archivos ZIP pueden pesar hasta 20 MB, con un máximo de 64 MB y 2000 entradas una vez descomprimidos. `SKILL.md` puede pesar hasta 256 KB, y cada bot puede tener hasta 100 habilidades importadas. Si un ZIP contiene varios archivos `SKILL.md`, empaqueta cada habilidad por separado.

## Instalar desde la biblioteca de habilidades o GitHub

- En la pestaña Habilidades de Apps y habilidades puedes explorar la biblioteca por categoría o por autor; la sección de habilidades de la configuración del bot también tiene «Ver habilidades». Haz clic en «Copiar instrucción de instalación» y envíasela a cualquier bot.
- También puedes enviarle al bot el enlace de GitHub de una habilidad (un repositorio, una carpeta `/tree/<rama>/<ruta>` o un archivo `SKILL.md`) y decirle «instala esto».
- El bot lee el nombre, la descripción, el origen, la licencia y la cantidad de archivos de la habilidad y muestra una tarjeta de confirmación. No se escribe nada hasta que haces clic en Instalar, y la habilidad se instala solo en ese bot. En los canales de chat, responde con el código de la tarjeta; las tarjetas de Feishu tienen botones. Solo el dueño puede instalar habilidades.
- Las habilidades instaladas muestran el origen «GitHub · repositorio» en la lista; en Ver aparecen el repositorio, la ruta, la rama, el commit instalado y la hora de instalación.

## Importar desde este equipo (Mi biblioteca de habilidades)

Las habilidades que ya instalaste para otras herramientas del equipo (como Claude Code, Codex, Cursor o CodeBuddy) se pueden importar de una vez a Mi biblioteca de habilidades y luego activarlas en tus bots.

- Dónde: menú del avatar › Mi biblioteca de habilidades › Importar desde este equipo…, o ajustes del bot › Habilidades › Importar desde este equipo…. Solo se puede buscar en la app de escritorio del equipo donde está la biblioteca; en el navegador o en remoto, sigue usando un ZIP o un enlace de GitHub.
- Se buscan automáticamente seis ubicaciones: `~/.codebuddy/skills/`, `~/.qwenworkcn/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` y `~/.codex/skills/`. Solo se listan carpetas y nombres de archivo `SKILL.md`; no se leen instrucciones, recuerdos ni cuentas. Para otras ubicaciones (como `~/.workbuddy/skills/`, `.user_skills/` de Doubao o un proyecto), usa Elegir carpeta…; en un proyecto solo se revisan ubicaciones conocidas como `.claude/skills/`. Nunca se recorre entera la carpeta personal, la raíz de un disco ni la carpeta de datos de aplicaciones.
- Al principio no hay nada seleccionado. Las habilidades solo se leen tras seleccionarlas y pulsar Siguiente. La revisión indica para cada una: lista para importar, ya existe (contenido idéntico; mantiene su estado), mismo nombre con contenido distinto (se omite por defecto; Guardar por separado conserva el nombre de invocación y añade un número al nombre visible) o no compatible (con el motivo). Las que tienen scripts se marcan «Contiene scripts; importar no los ejecuta» y las que tienen dependencias, «Dependencias sin verificar».
- Si abres desde un bot, «Usar en {bot} después de importar» viene marcado; desde la biblioteca, solo se añaden a la biblioteca. Al terminar ves cuántas se añadieron, activaron, omitieron y fallaron. Si no se pueden activar (ya hay una habilidad con ese nombre activada o el bot está lleno), el contenido añadido se queda en la biblioteca.
- No se importan habilidades con posibles archivos privados (`.env`, `id_rsa`, `credentials.json`, `memory.md`…), enlaces que apuntan fuera de la ubicación elegida, restricciones que esta app no puede mantener igual (como `allowed-tools` o `hooks`), variables de ruta de plataforma (como `${CLAUDE_PLUGIN_ROOT}`) o archivos referenciados que faltan. `disable-model-invocation` y `user-invocable` se conservan tal cual; `allow_implicit_invocation: false` de Codex se escribe como `disable-model-invocation: true`.
- Importar es copiar: el origen no cambia ni se sincroniza. Cada habilidad se guarda una sola vez en la biblioteca y cada bot solo guarda un interruptor: Añadir desde la biblioteca… en los ajustes del bot, o el interruptor, afecta solo a ese bot. Las habilidades ZIP y de GitHub instaladas en los bots y las que guardaste también aparecen en la biblioteca.
- En Mi biblioteca de habilidades, abre una habilidad para ver su contenido y los bots que la usan. Si ningún bot tiene activada una habilidad importada, ⋯ › Quitar de la biblioteca borra solo la copia de la biblioteca.

## Usar, reemplazar y eliminar

- Una habilidad solo se aplica al bot al que la agregas (sobre Mis habilidades, ver abajo). Ese bot usa las mismas habilidades en la app y en los canales de chat.
- Desde la lista, puedes ver las instrucciones y activar, desactivar o eliminar habilidades. Los cambios esperan a que el bot esté inactivo.
- Tras importar, el aviso dice cuándo estará lista la habilidad (desde tu próximo mensaje, cuando termine la tarea actual o cuando termine de cargar) y muestra un ejemplo **Prueba decir** con **Insertar en el mensaje** (abre el chat de este bot) y **Copiar**. Se queda hasta que uses un botón o lo cierres.
- Para reemplazar una habilidad, vuelve a importar una con el mismo nombre, revísala y haz clic en Reemplazar habilidad. El reemplazo conserva su estado activado o desactivado.
- Al eliminar una habilidad se borran sus archivos, pero se conserva lo que ya se generó en el espacio de trabajo.
- Los nombres integrados como `media`, `computer-use` y `amb-app`, así como las habilidades que aportan los bots del catálogo, no se pueden sobrescribir con paquetes importados.

Las habilidades se ejecutan con los permisos que ya tiene el bot. Una habilidad que necesita Python, otro software o la conexión de una cuenta requiere ese entorno. Las habilidades que dependen de herramientas propias de otro cliente pueden necesitar cambios. Que el formato sea compatible no significa que todas las herramientas de apoyo estén instaladas.

## Usar en un chat

- Haz clic en **+** › **Habilidades y apps**, a la izquierda del cuadro de mensaje, para ver las habilidades y apps que este bot puede usar ahora. Al elegir una, se escribe "Usa {nombre} para ayudarme a…" en el cuadro; completa la frase y envíala. El bot decide si la usa.
- En la configuración, cada habilidad muestra **Activa**, **Activa desde tu próximo mensaje** o **Cargando** junto a su nombre, y debajo una línea **Prueba decir**. Haz clic en esa línea para ponerla en el cuadro de mensaje de este bot.
- Mientras el bot usa una habilidad o una app, el proceso sobre su respuesta muestra "Usando la habilidad · {nombre}" y, para las apps, una línea por herramienta: "Usando {app} · {herramienta}" (con el nombre visible de la herramienta cuando la app lo ofrece). Al terminar la respuesta, se resume en una línea, "Usado: …", que puedes expandir para ver todos los pasos.
- Pregúntale al bot "¿Qué habilidades tienes?" o "¿Qué apps tienes?" y te dirá cuáles puede usar ahora, cada una con un ejemplo que puedes enviar.
- Una habilidad cuyo `SKILL.md` indica `disable-model-invocation: true` nunca la usa el bot por su cuenta y no aparece en **Habilidades y apps**. Escribe `/nombre-de-la-habilidad` en un mensaje para usarla.

## Guardar lo que hiciste como habilidad

Cuando un bot hace algo bien, puedes guardar cómo lo hizo en Mis habilidades, usarlo la próxima vez o programarlo.

- Para empezar: en el menú + del cuadro de texto elige «Guardar como habilidad…», envía `/skill` o simplemente di «guardar como habilidad». Para guardar solo una parte, di «guarda el paso 3 como habilidad». Si el bot todavía está respondiendo, espera a que termine este turno.
- El bot muestra «Armando la habilidad…» y luego una tarjeta de borrador: título y nombre de archivo, cuándo usarla, pasos, lo que corregiste (puedes desmarcarlo), las apps y habilidades que usa, y «Prueba a decir». «Editar» abre el archivo de la habilidad y se revisa de nuevo al terminar. No se escribe nada hasta que haces clic en Guardar; la tarjeta vence a los 30 minutos.
- Los secretos (claves de API, tokens, contraseñas, códigos de verificación, cookies, números de identificación) nunca se escriben en la habilidad y no se puede guardar si los agregas al editar. Los teléfonos, correos, nombres, nombres de grupos y rutas de archivos fuera del espacio de trabajo se resaltan y por defecto quedan en «Preguntar cada vez»: se guardan como marcadores y el bot te los pregunta antes de cada uso. Elige «Conservar» para escribir el original en la habilidad.
- También puedes guardar una tarea sin terminar: el borrador dice dónde se detuvo y la habilidad queda «No verificada» hasta que se complete con éxito una vez.
- Si el título coincide, o el bot ve que es la misma tarea, la tarjeta muestra cuántos cambios hay y ofrece «Actualizar» o «Guardar como nueva». Al actualizar se conserva la versión anterior, que puedes restaurar en Administrar.
- Mis habilidades es una sola lista que se guarda solo en esta computadora, con hasta 100 habilidades, contadas aparte de las que importa cada bot. Al principio solo está activada para el bot que la guardó; para usarla en otro bot, activa su interruptor en la lista de habilidades de ese bot. Solo el dueño puede guardar habilidades, y no desde un grupo de WeChat o Feishu.
- En la lista de habilidades, las filas de Mis habilidades tienen «Ver» y «Administrar». Administrar permite exportar un ZIP (solo los archivos de esta habilidad, con un aviso si conserva datos personales), restaurar la versión anterior o eliminarla. Un ZIP exportado se puede importar en otra computadora como habilidad de ZIP local.
- Después de guardar, «Programarla» hace que el bot pregunte la hora y cree una rutina «Hacer una tarea» que siempre usa la versión más reciente. Las habilidades que necesitan controlar la computadora, generar imágenes o videos o iniciar tareas en segundo plano, y las no verificadas, no se pueden programar. Si la habilidad se elimina, se desactiva para ese bot o, tras actualizarla o restaurarla, necesita nuevas respuestas, suma pasos que las ejecuciones programadas no pueden hacer o queda sin verificar, la rutina se pausa y aparece en Requiere atención dentro de Programado.
- Con más de 10 habilidades, la lista muestra un cuadro de búsqueda y los filtros «Todas / Mis habilidades / GitHub / ZIP local / Desactivadas». Los nombres de habilidades en la actividad abren sus detalles.

## Almacenamiento

Los paquetes descomprimidos se guardan en `skills/<bot ID>/`, dentro de la carpeta de datos. Las habilidades activadas se copian en `dsh/<bot ID>/skills/` para el entorno de ejecución. La importación solo sube los archivos a la instancia de AnyModelBot que estás usando; en una instalación en servidor, los archivos se guardan en ese servidor. Los nombres y las descripciones de las habilidades activadas, y las instrucciones o referencias que se cargan durante el uso, pasan a formar parte del contexto que se envía al modelo que hayas seleccionado. Consulta [Datos y privacidad](./privacy_es.md).

Mis habilidades se guardan en `my-skills/` dentro del directorio de datos y, al ejecutarse, se copian a `dsh/<ID del bot>/skills/` de cada bot donde están activadas.

Las habilidades importadas desde este equipo se guardan en `skill-library/` dentro del directorio de datos y, al ejecutarse, se copian a `dsh/<ID del bot>/skills/` de cada bot que las tenga activadas. Al eliminar un bot, las habilidades que tenía instaladas se quedan en Mi biblioteca de habilidades.
