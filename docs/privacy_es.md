# Datos y privacidad

[简体中文](./privacy.md) | [繁體中文（台灣）](./privacy_zh-TW.md) | [English](./privacy_en.md) | [日本語](./privacy_ja.md) | [한국어](./privacy_ko.md) | [Русский](./privacy_ru.md) | Español | [Português (Brasil)](./privacy_pt.md) | [Türkçe](./privacy_tr.md)

**En una frase:** las conversaciones, la memoria, los archivos y las claves se guardan en tu dispositivo; lo que envías a un modelo va al proveedor de modelos que elegiste, directamente si usas tu propia clave de API oficial y, si no, a través de Modelflare. No afirmamos que tus datos estén libres de todo riesgo: todo lo que se envía a un modelo sale de tu dispositivo.

Este documento explica qué guarda AnyModelBot y dónde, qué sale de tu dispositivo y cómo eliminarlo. Si tienes preguntas: [support@anymodel.bot](mailto:support@anymodel.bot).

## Carpeta de datos

| Cómo lo ejecutas | Carpeta de datos |
| :--- | :--- |
| Escritorio · Windows | `%APPDATA%\anymodel bot\data` |
| Escritorio · macOS | `~/Library/Application Support/anymodel bot/data` |
| Escritorio · Linux | `~/.config/anymodel bot/data` |
| Línea de comandos `npm start` | `./data` (se cambia con `AMB_DATA_DIR`) |
| Docker | `/data` dentro del contenedor (montado como el volumen `amb-data` en el ejemplo del README) |

## Inventario de datos

| Datos | Dónde se guardan (dentro de la carpeta de datos) | ¿Salen del dispositivo? | Adónde van |
| :--- | :--- | :--- | :--- |
| Conversaciones y sesiones | `anymodel.db` (SQLite) | La parte que hace falta para responder | Se envían como contexto del modelo, a través de Modelflare, al proveedor que elegiste |
| Habilidades importadas | `skills/<bot ID>/`; las copias activadas, en `dsh/<bot ID>/skills/` | Sí: los nombres, las descripciones y el contenido que se carga durante el uso | Contexto para el modelo seleccionado; la importación solo sube los archivos a tu instancia de AnyModelBot y no se conecta con GitHub |
| Índice de búsqueda de chats | `message_search` y su índice de texto completo en `anymodel.db` | No | Busca en los mensajes guardados dentro de la instancia sin llamar a ningún modelo |
| Memoria | `memory/` (Markdown: `bots/`, `groups/`; Sobre mí: `about-me.json`, con 30 días de historial de cambios; `team/` es la memoria del equipo de antes de actualizar, ya movida a Sobre mí y sin uso) | Cuando se usa | Se incluye como contexto en las solicitudes a los modelos; todo lo que parece un dato secreto se filtra antes de escribirse, los números de documentos y tarjetas bancarias nunca se guardan, y las direcciones, teléfonos y correos se guardan en Sobre mí solo si confirmas |
| Archivos del espacio de trabajo de los bots | `workspaces/<bot>/` (incluidos los archivos recibidos en `inbox/` y las imágenes y videos generados en `media/`) | Cuando un bot los lee y los envía a un modelo | Igual que arriba |
| Adjuntos de mensajes | `attachments/` (copias de las imágenes que pegas y de las imágenes y archivos de texto que arrastras a un chat, con nombres aleatorios; las imágenes se guardan sin EXIF ni otros metadatos). Las no enviadas se conservan hasta 24 horas y las enviadas 30 días; después se eliminan | Al enviar el mensaje | Las imágenes y el texto completo de los archivos van con ese mensaje en la solicitud al modelo, al proveedor que elegiste; eliminar la copia local no retira lo ya enviado |
| Credencial de inicio de sesión de Modelflare | `modelflare-account.json` (modo 600) | Solo a modelflare.dev al renovar los tokens | Modelflare |
| Clave de API | La configuración aislada del gateway en `magpie/config/` | Como autenticación en cada solicitud de modelo que se envía a Modelflare | Modelflare |
| Clave de API oficial (si agregas una) | La configuración aislada del gateway en `magpie/config/` | Como autenticación en cada solicitud de modelo que se envía a ese proveedor | Ese proveedor de modelos |
| Estado de la sesión de WeChat y cursor de sincronización | Dentro de la carpeta de datos (`weixin/` y otras) | Al comunicarse con la API iLink de WeChat | Tencent WeChat |
| App ID / Secret de las cuentas de chat de Feishu | `anymodel.db` | Al abrir la conexión persistente con la plataforma abierta de Feishu | Feishu |
| Tokens de Telegram, Slack y Discord | `anymodel.db` | Al comunicarse con esa plataforma | La plataforma que conectaste |
| Lista de permitidos y solicitudes de acceso | `anymodel.db`: quién puede usar cada cuenta de canal y el primer mensaje que envió un desconocido (truncado, para que sepas quién es) | No | — |
| Respuestas pendientes de envío | Bandeja de salida en `anymodel.db`: el contenido de los mensajes sin enviar y el motivo, incluidos los mensajes de WeChat retenidos hasta que la persona vuelva a escribir (se guardan hasta 7 días; los enviados se eliminan después de 7 días y los que no se pueden entregar, después de 30) | Cuando se envían | WeChat / Feishu |
| Tareas en segundo plano y reglas | `anymodel.db` (tareas, reglas y registros de ejecución, que se guardan 30 días); carpetas de tareas en `workspaces/<bot>/tasks/`, que se eliminan tras 30 días sin usarse (antes se te avisa en Te necesita); sus archivos de sesión en `dsh/<bot>/sessions/`, que se eliminan junto con la tarea | Mientras se ejecutan | Igual que en los chats: contexto en las solicitudes a los modelos, enviado a través de Modelflare al proveedor que elegiste |
| Ajustes | `config.json` | No | — |
| Registros | `logs/app.log` (rotación por tamaño) | No por defecto; “Copiar diagnóstico” es algo que copias tú a mano, con las claves reemplazadas por `***`. Solo si en Solicitudes y comentarios, en Informar de un problema, marcas “Incluir el estado y los registros recientes” y envías, las últimas 120 líneas (claves reemplazadas) van con ese envío | Tu ticket privado de Modelflare (solo cuando envías) |
| Credenciales de las apps conectadas (solo si las conectas): tokens de inicio de sesión, tokens y claves pegados, URL dedicadas, y los encabezados / parámetros de consulta / variables de entorno de los conectores MCP personalizados | `app-secrets.json` (permisos 600, fuera de la base de datos); enmascaradas en los registros, el diagnóstico y la interfaz | Se envían a ese servicio como autenticación cada vez que un bot lee o escribe; las variables de entorno de un comando local solo llegan al programa local que agregaste | Las apps que conectas (Feishu, Tencent Docs, DingTalk, Amap, Yuque, Notion, GitHub, Linear, Atlassian, Canva) o los servidores MCP personalizados que agregas |
| Nombres, direcciones, estado y listas de herramientas de las conexiones | `anymodel.db` (las URL dedicadas y las direcciones que contienen una clave se guardan enmascaradas) | No | — |
| Contenido que un bot lee de las apps conectadas (documentos, mensajes, issues…) | No se guarda por separado; una vez que entra en un chat, se guarda con ese chat | Sí | Se envía como contexto en las solicitudes a los modelos, a través de Modelflare, al proveedor que elegiste |
| Capturas de pantalla (uso de la computadora) | No se conservan a largo plazo | Sí | Se envían como parte de la solicitud, a través de Modelflare, a un modelo con visión; nunca se reenvían a los chats de WeChat o Feishu, salvo que las pidas como archivos |

## Control de acceso a la consola local

- De forma predeterminada, la consola escucha en `127.0.0.1:3600` y no es accesible desde tu red ni desde internet.
- La app de escritorio genera un token de acceso aleatorio en cada inicio, para que otros programas locales no puedan llamar directamente a la API de administración.
- La API de la consola siempre requiere un token de acceso, también en la dirección de loopback. La app de escritorio guarda su token solo en memoria; la versión de línea de comandos y Docker generan uno si no hay ninguno configurado y lo guardan en `ui-token`, en la carpeta de datos (Docker: `docker exec amb cat /data/ui-token`). Si se inicia desde una terminal, la versión de línea de comandos muestra una vez un enlace con el token.
- No expongas el puerto 3600 directamente a internet. Para el acceso remoto, ponlo detrás de una VPN o de un proxy inverso con autenticación que tú controles.

## Inicio de sesión en Modelflare

- El inicio de sesión usa el flujo de código de autorización de OIDC con PKCE (RFC 7636), como app nativa según la RFC 8252: AnyModelBot es un cliente público sin secreto de cliente, y el resultado de la autorización se entrega a un puerto de loopback temporal.
- Inicias sesión en modelflare.dev; AnyModelBot nunca ve tu contraseña de Modelflare.
- Puedes revocar el acceso de este dispositivo en cualquier momento en la sección de aplicaciones autorizadas de tu página de perfil de Modelflare. “Cerrar sesión” en la app también revoca la autorización y elimina las claves emitidas para este dispositivo y sus bots.

## Solicitudes a los modelos y Modelflare

- Las solicitudes a los modelos van del gateway magpie integrado a Modelflare, que las reenvía al proveedor que elegiste.
- Una solicitud contiene lo que el modelo necesita para responder: el prompt, el contexto de la conversación, la memoria en uso, el contenido de los archivos, los resultados de las herramientas y, con el uso de la computadora, capturas de pantalla.
- Las solicitudes llevan el encabezado `X-Modelflare-Skill: anymodel-bot/<version>` para que Modelflare pueda identificar su origen; los enlaces de Modelflare que se abren desde la app llevan `utm_source=anymodelbot`. Cuando la app abre la página de recarga, la URL lleva después de `#` el identificador de cuenta del token de ID del inicio de sesión (`#amb_account=…`, que no es un dato secreto), para que la página de Modelflare compruebe que el navegador tiene abierta la sesión de la misma cuenta; lo que va después de `#` no se envía a servidores, CDN ni scripts de analítica. El aviso “La configuración de la clave cambió” compara un HMAC de la clave calculado localmente con una sal aleatoria; ni la clave ni su resumen se guardan ni se suben para esto.
- Modelflare guarda registros de las solicitudes; consulta en el [Centro de confianza de Modelflare](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme) qué se guarda y durante cuánto tiempo. El tratamiento de los datos por parte de cada proveedor de modelos se rige por sus propios términos.

## Uso de tus propias claves de API oficiales

- Después de que ingresas una clave oficial de OpenAI, Anthropic u otro proveedor en la pantalla de bienvenida o en Ajustes → Modelos, el gateway integrado envía las solicitudes a los modelos de ese proveedor directamente a él. No pasan por Modelflare ni llevan el encabezado `X-Modelflare-Skill`. Los términos propios de ese proveedor rigen cómo se conserva el contenido.
- Las direcciones de los proveedores están fijadas en la app y no se pueden cambiar desde la interfaz ni desde su API, así que tu clave no se envía a ningún otro lugar. Las claves solo se guardan en la configuración aislada del gateway (modo 600), nunca en los registros ni en argumentos de línea de comandos, y la interfaz solo muestra los últimos 4 caracteres.
- Si solo usas claves oficiales y no inicias sesión, la app no lee los datos de tu cuenta de Modelflare ni su catálogo de precios. Cuando ingresas una clave, la app la usa para leer una vez la lista de modelos de ese proveedor y así comprobarla, y luego cada hora para mantener la lista al día.
- El gateway integrado lee el catálogo público de modelos de `models.dev` (longitudes de contexto, precios de referencia). Esta solicitud solo descarga datos y no lleva claves ni contenido de las conversaciones.
- La generación de imágenes y video solo está disponible a través de Modelflare.

## Telemetría

- La telemetría del controlador de uso de la computadora incluido (Cua Driver) está desactivada con `CUA_TELEMETRY_ENABLED=0` y `CUA_DRIVER_RS_TELEMETRY_ENABLED=0`.
- El gateway magpie incluido se ejecuta con la actualización automática y la detección de cuentas desactivadas, y no lee las credenciales de otras herramientas de IA de tu computadora.
- El código propio de AnyModelBot (`src`, `electron`, `ui`, `scripts`, `dsh-runtime/plugins`) no contiene envío de analíticas ni de telemetría: una búsqueda de telemetry, analytics, sentry, posthog y mixpanel solo encuentra las dos variables de entorno de Cua mencionadas arriba.
- Los componentes de terceros incluidos se comportan como describe su propia documentación; aquí no ofrecemos garantías sobre ellos.

## Otras solicitudes de red que hace la app

Además de las solicitudes a los modelos, la app se conecta a internet para:

- Leer el catálogo de modelos de Modelflare, tu saldo, tu uso y tus notificaciones (los datos de tu cuenta, desde modelflare.dev).
- Al enviar desde Solicitudes y comentarios (casos de uso e ideas, informar de un problema o empresas y alianzas): lo que escribiste, el contexto o los datos de empresa que añadiste, el rol que elegiste, desde dónde lo abriste, la versión y los datos del sistema, y el error y los registros que elegiste incluir (con las claves reemplazadas por `***`) van a modelflare.dev como un ticket privado en tu cuenta de Modelflare. Las respuestas te llegan por correo y aparecen en la página de tickets de Modelflare. Antes de enviar puedes revisar todo lo que se enviará; nunca se adjuntan conversaciones ni capturas. Los datos de contacto no se envían por defecto: solo si abres “¿Seguimos hablando?”, marcas “Acepto que me contacten solo sobre estos comentarios” y eliges el correo de tu cuenta o escribes un correo o un ID de WeChat, y solo para el seguimiento de esos comentarios. Al cerrar la ventana, iniciar sesión o cambiar de cuenta se te vuelve a preguntar. Los borradores se quedan en la carpeta de datos de este dispositivo (por cuenta, legibles solo por ti, no por los bots, se borran tras 7 días sin uso) y nunca se sincronizan. Sin sesión en Modelflare, o con un gateway externo, no se pueden crear tickets en la app; puedes enviarlo tú por correo o en GitHub (público), y esa copia no lleva datos de contacto ni de empresa. “Contactar con Modelflare” abre la página de contacto comercial sin nada de lo que escribiste.
- Leer desde docs.modelflare.dev el formato de solicitud de un modelo al generar imágenes o video.
- Canal de WeChat: comunicarse con `ilinkai.weixin.qq.com` y descargar desde la CDN de WeChat las imágenes y archivos que envías.
- Canal de Feishu: mantener una conexión persistente con la plataforma abierta de Feishu.
- Canales de Telegram, Slack y Discord: una vez conectados, comunicarse con `api.telegram.org`, `slack.com`, `discord.com` y sus servidores de archivos para enviar y recibir mensajes y los archivos que envías.
- En Windows, con el modo agente activado y sin un PowerShell 7 que funcione en el sistema, descargar PowerShell 7 desde la ubicación oficial de publicación de Microsoft (se desactiva con `AMB_PWSH_AUTO_INSTALL=0`; consulta la [guía de desarrollo](./development_es.md)).
- Las apps de escritorio instaladas buscan actualizaciones en GitHub después de iniciar y cada 6 horas, y de forma predeterminada descargan los archivos de actualización en segundo plano. Puedes desactivar las descargas automáticas en Ajustes → General. Las solicitudes no contienen credenciales de la cuenta ni contenido de los chats. La instalación requiere que hagas clic en Reiniciar y actualizar, sin tareas en ejecución.
- Cuando abres Novedades de una versión que aún no instalaste, la app lee el registro de cambios de esa versión desde GitHub (`raw.githubusercontent.com`). Solo lo hace cuando lo abres, sin credenciales de la cuenta ni contenido de los chats. El registro de cambios de las versiones instaladas viene con la app y no necesita conexión.
- Solo si defines explícitamente `AMB_CATALOG_URL` para usar un catálogo de bots remoto, la app descarga su lista y los paquetes cuando se necesitan, y verifica las firmas y los hashes sin subir tus datos. De forma predeterminada, el catálogo oficial de bots, sus interfaces, los datos de ejemplo y las habilidades vienen con la app; abrirlos e instalarlos no genera ese tipo de solicitudes de red.

## Uso de la computadora y capturas de pantalla

- Leer la pantalla implica tomar capturas, que se envían como parte de la solicitud a un modelo con visión.
- De forma predeterminada, las acciones de uso de la computadora se ejecutan automáticamente. En Ajustes del bot → Uso de la computadora puedes cambiar a “preguntarme antes de las acciones que cambian la pantalla”; la lectura de la pantalla sigue siendo automática.
- Los bots con el modo de solo lectura solo reciben herramientas de lectura.

## Canales

- Los mensajes que intercambias con un bot en WeChat, Feishu, Telegram, Slack o Discord pasan por los servidores de esas plataformas y están sujetos a sus políticas de privacidad.
- De forma predeterminada, solo el propietario y las personas que autorices pueden hablar con un bot; los mensajes de cualquier otra persona no se le pasan a ningún modelo, solo se registran como solicitudes de acceso (consulta la [guía de desarrollo](./development_es.md#quién-puede-usar-un-bot)).

## Eliminar tus datos

1. Sal de AnyModelBot (menú de la bandeja → Salir).
2. Elimina la carpeta de datos indicada en la tabla de arriba. Docker: `docker rm -f amb && docker volume rm amb-data`.
3. Revoca el acceso de AnyModelBot en la sección de aplicaciones autorizadas de tu página de perfil de Modelflare.
4. Si es necesario, desactiva las apps que creaste en la plataforma abierta de Feishu (incluidas las creadas escaneando un código), desvincula el bot en WeChat, elimina los bots que creaste en Telegram (@BotFather), Slack y Discord, y en los ajustes propios de cada app (Notion, Feishu, GitHub, etc.) revoca la autorización de AnyModelBot y elimina los tokens y claves que hayas creado.
