# Registro de cambios

[简体中文](./CHANGELOG.md) | [English](./CHANGELOG_en.md) | [日本語](./CHANGELOG_ja.md) | [한국어](./CHANGELOG_ko.md) | [Русский](./CHANGELOG_ru.md) | Español | [Português (Brasil)](./CHANGELOG_pt.md)

Aquí se recogen los cambios que notarás en la app. Para versiones anteriores, consulta las [versiones publicadas en GitHub](https://github.com/modelflare-ai/AnyModelBot/releases).

## 0.1.35 - 2026-11-14

### Mejoras y correcciones

- **Barra lateral e iconos más sencillos:** las acciones comunes usan Heroicons. Arriba quedan contraer, buscar y crear; Programadas pasa a la navegación con texto. El botón junto a la cuenta descarga actualizaciones y permite reiniciar para instalarlas cuando estén listas.
- **Saldo visible en Ajustes:** Ajustes → Modelos muestra el saldo, los créditos de Bot y el porcentaje restante, con acciones para actualizar y recargar. Se eliminan el anillo de saldo y la tarjeta al pasar el cursor de la barra lateral.
- **Vistas previas estables:** el campo de dirección y el selector de recursos usan controles compartidos. Cambiar de pestaña en el panel derecho conserva su anchura, incluidos los ajustes manuales. Se corrige el botón para expandir la barra lateral después de contraerla.
- **Errores más claros:** los fallos al reservar cuota se clasifican como saldo insuficiente, también con mensajes que llevan prefijos. Las acciones de recuperación corresponden al proveedor y la barra lateral no muestra errores sin procesar.
- **Permisos del ordenador más claros:** se usa un título singular cuando falta un permiso y reabrir la app pasa a ser la acción principal cuando hace falta. Antes de reabrir se conservan los borradores de chats y formularios y las solicitudes pendientes.
- **Correcciones de reglas:** cambiar el interruptor o el destino conserva la opción de deshacer. El propietario gestiona reglas entre conversaciones y los miembros de grupos quedan aislados por identidad. La frecuencia se calcula para los próximos 30 días y se sugieren intervalos de tres horas o diarios.
- **Guías y textos coherentes:** la memoria inicial de las plantillas y las revisiones automáticas ya no completan el paso de recordar al usuario. Ejemplos, mensajes de deshacer, formularios y guías de activación se unifican en siete idiomas.

## 0.1.34 - 2026-11-14

### Novedades

- **Diagnóstico desde el inicio:** antes de solicitar el bloqueo de instancia única, la aplicación crea un `startup-<time>-<PID>.log` separado con la versión del sistema, la carpeta real de datos, el resultado del bloqueo y las etapas de arranque. Si no puede escribir ahí, intenta usar la carpeta temporal del sistema.
- **Opción de diagnóstico:** al iniciar con `--diagnose-startup`, se muestra la ubicación del registro si no se obtiene el bloqueo, para investigar cierres sin ventana.

### Mejoras y correcciones

- Si se vuelve a iniciar antes de que el servicio de interfaz esté listo, la solicitud de mostrar la ventana espera hasta terminar el arranque, evitando crearla antes de tiempo.
- Cada inicio tiene su propio registro y la instancia principal conserva los veinte más recientes. Un segundo inicio no rota el `app.log` habitual de la aplicación en ejecución.
- Esta actualización mejora el diagnóstico de [#71](https://github.com/modelflare-ai/AnyModelBot/issues/71); aún no se ha confirmado la causa del cierre inmediato en Win11 Insider Build 26300. Si `ELECTRON_RUN_AS_NODE` activa el modo Node, el código de la aplicación no se ejecuta y hay que revisar primero esa variable. La carpeta predeterminada de registros en Windows es `%APPDATA%\anymodel bot\data\logs`, con un espacio en el nombre.

## 0.1.33 - 2026-11-14

### Novedades

- **Todas las reglas en Programado:** la nueva página reúne las reglas de todos los bots y destaca las que requieren atención. Las tarjetas de chat, Tareas y Programado comparten interruptores. Puedes crear reglas antes de la primera conversación y dejarlas desactivadas. Los cambios del chat se pueden deshacer; una creación deshecha se puede restaurar durante diez minutos.
- **Recuperación de ejecuciones y resúmenes de grupos:** las reglas de calendario recuperan una sola ejecución reciente dentro de un plazo de hasta doce horas e indican la hora prevista. Las reglas por intervalo no se recuperan. Se añaden programación mensual, tres próximas ejecuciones, zonas horarias y estimaciones de gasto. Los resúmenes de un grupo de la aplicación conservan su fecha original aunque lleguen tarde.
- **Diez plantillas de bots:** elige un papel para escribir, trabajar o estudiar, revisa la personalidad, la memoria y las reglas, y compara modelos adecuados. Las reglas de las plantillas comienzan desactivadas y solicitan destino y grupo de origen cuando hace falta.
- **Vista previa de recursos a la derecha:** abre archivos y sitios desde conversaciones, grupos y espacios de trabajo sin salir del chat. Admite Markdown, texto y código, PDF, imágenes y HTML, con opciones de descarga y apertura externa.
- **Espacios de trabajo adaptados al panel:** la navegación de proyectos de los bots oficiales se recoge cuando hay poco ancho. Puedes ampliar el espacio y volver al chat conservando la edición.
- **Continuar tras conceder permisos en macOS:** una tarjeta sustituye los errores repetidos. La aplicación comprueba los permisos automáticamente y, cuando corresponde, retoma los pasos pendientes en la conversación original conservando los borradores. Si envías otro mensaje o pasan más de treinta minutos, debes pulsar Continuar.

### Mejoras y correcciones

- Mejoras en el regreso del inicio de sesión de Modelflare, nombres y avatares de cuenta y guía inicial. Las listas de aplicaciones conectadas, la búsqueda y los errores son más claros.
- Mejoras en el lienzo de Film Studio y el procesamiento de gráficos de US Stock Research. PPT Master y Company Research también adoptan el nuevo espacio de trabajo.
- Los resultados indican su regla de origen y respetan la preferencia de notificaciones. Puedes evitar la suspensión antes de una ejecución cuando el ordenador está enchufado; no despierta un equipo ya suspendido o cerrado.

## 0.1.32 - 2026-11-11

### Novedades

- **Español y portugués (Brasil):** la app suma dos idiomas de interfaz. Elige uno en Ajustes → General → Idioma; si el idioma de tu sistema es español o portugués, la app lo usa automáticamente. La interfaz, el menú de la bandeja del sistema, los mensajes del sistema de tus bots y las Novedades están traducidos.
- **Bots oficiales en español y portugués:** PPT Master, Estudio de cine, Análisis de empresas y Acciones de EE. UU. tienen nombre, descripción, sugerencias para empezar, interfaz del espacio de trabajo y ejemplos en español y portugués.

### Mejoras y correcciones

- Los gráficos de Acciones de EE. UU. entienden los números que usan coma decimal (como 12,5 %), y las variaciones de los indicadores clave siguen el formato numérico del idioma de la interfaz.

## 0.1.31 - 2026-11-11

### Novedades

- **Conectar apps:** el menú del avatar, en la esquina inferior izquierda, tiene una nueva opción Conectar apps. Conecta las apps que usas y tus bots podrán leer y escribir su contenido. Conecta una vez y todos los bots pueden usarla de forma predeterminada; puedes restringirla por bot y por herramienta en la sección Apps de los ajustes de cada bot.
- **Apps integradas:** GitHub, Notion, Linear, Atlassian (Jira y Confluence) y Canva se conectan en uno o dos pasos.
- **Apps integradas para China:** Feishu (leer y escribir documentos en la nube, leer mensajes de chats grupales), Tencent Docs, DingTalk, Amap y Yuque. La interfaz en chino las muestra primero.
- **Conectores personalizados (MCP):** agrégalos en Mis MCP, en la página Apps. Pega una URL, un JSON de mcpServers, un comando `claude mcp add` o un comando de inicio local y se reconoce automáticamente; también puedes completar el formulario o editar el JSON. Funcionan tanto los servidores remotos como los comandos locales, con inicio de sesión, encabezados, parámetros de consulta o una URL dedicada para la autenticación, hasta 20 conectores.
- **Pregunta antes de cambiar tus datos:** las herramientas de solo lectura se ejecutan de inmediato. De forma predeterminada, las escrituras te preguntan primero en el chat, y puedes elegir Permitir siempre esta herramienta, algo que más adelante puedes revocar en los ajustes del bot. Las eliminaciones y cualquier cosa que se envíe a otras personas siempre preguntan. Los bots de solo lectura no pueden escribir.
- **Arregla una conexión desde el chat:** cuando una tarea necesita una app que no está conectada, o un inicio de sesión venció o una clave dejó de funcionar, aparece una tarjeta en el chat. Haz clic en ella para conectarla o arreglarla, y el bot continúa con la tarea.
- **Panel derecho:** el panel de información ahora es una fila de pestañas: Resumen, Tareas y Memoria. Los bots oficiales agregan una pestaña Espacio de trabajo para su propia interfaz, y el área principal siempre es el chat.
- **Secciones en la barra lateral:** organiza bots, chats grupales y bots oficiales en secciones que tú creas. Las secciones se pueden agregar, cambiar de nombre, eliminar y reordenar arrastrándolas.
- **Los bots oficiales tienen su propio aspecto:** PPT Master, Estudio de cine, Análisis de empresas y Acciones de EE. UU. tienen cada uno su propio avatar y una portada nueva. Los bots cuyo avatar no hayas cambiado se actualizan automáticamente.

### Mejoras y correcciones

- Ajustes › Conexiones ahora se llama Canales de chat y solo contiene cuentas de apps de chat. Tus cuentas de Notion existentes se movieron a Conectar apps y no hace falta volver a autorizarlas.
- Las cuentas de mensajes de Feishu existentes también se movieron a la tarjeta de Feishu en Conectar apps sin necesidad de volver a autorizarlas; autoriza de nuevo para leer y escribir también documentos en la nube.
- Crear y actualizar páginas de Notion ahora pregunta primero, según la regla anterior.
- Los tokens, las claves y las URL dedicadas de las apps se guardan en un archivo aparte, no en la base de datos, y se enmascaran en la interfaz y en los registros.
- macOS ya no muestra un aviso del llavero: el inicio de sesión de Modelflare está protegido por los permisos del archivo, como las demás credenciales.
- Cuando falla el inicio de sesión o la conexión con Modelflare, el mensaje indica el motivo de red real.
- Puedes arrastrar la ventana desde un espacio vacío de la página Descubrir.
- La guía de un chat grupal nuevo ahora consiste en tres consejos breves y dos o tres sugerencias para empezar; haz clic en una sugerencia para ponerla en el cuadro de entrada.
- Los ajustes de modelo de la página Nuevo bot se ven como el grupo Modelo de los ajustes del bot, y el botón Crear ocupa todo el ancho del formulario.
- Se quitó la nota que aparecía debajo de Comentarios en el menú del avatar.

## 0.1.30 - 2026-11-10

### Novedades

- **Créditos de Bot:** las cuentas con créditos de Bot de Modelflare ven un anillo y el porcentaje restante en la esquina inferior izquierda. Haz clic para ver tus créditos de Bot, el saldo de la cuenta y el enlace Recargar. Los créditos de Bot solo se pueden usar en AnyModelBot, y las solicitudes con claves emitidas por la app los usan primero. Las cifras se actualizan al abrir la tarjeta y después de procesar cada mensaje. Las cuentas sin créditos de Bot ven la esquina igual que antes.
- **$1 en créditos de Bot para cuentas nuevas:** la página de inicio de sesión y la página de clave de API ahora mencionan el crédito por registrarse. Las suscripciones de Modelflare suman créditos de Bot equivalentes al 10 % del plan, como también explica la tarjeta de créditos de Bot.
- **Novedades tras cada actualización:** después de una actualización, el primer inicio muestra qué cambió, y puedes desplazarte hacia abajo por todas las versiones. Al hacer clic en el aviso de nueva versión de la barra lateral, primero se muestran las notas de esa versión, para que decidas antes de descargar o reiniciar. El registro de cambios está siempre disponible en Ajustes → Acerca de.
- **Bots oficiales como espacios de trabajo de escritorio:** Análisis de empresas, PPT Master, Estudio de cine y Acciones de EE. UU. muestran tu trabajo en una lista a la izquierda y el contenido a la derecha. Nuevo abre un breve formulario guiado. La barra superior alterna entre Espacio de trabajo y Chat, donde ves la conversación completa. Acciones de EE. UU. muestra las cifras clave en gráficos, Estudio de cine tiene un storyboard con pistas de imagen, video y audio, y PPT Master te permite hojear las vistas previas.
- **Elección de modelo en los bots con interfaz propia:** el cuadro de entrada funciona como en un chat normal, con el selector de modelos, el menú + y los comandos con barra.
- **Chats recientes en la búsqueda:** antes de que escribas, el cuadro de búsqueda muestra los chats recientes agrupados en Hoy, Ayer, 7 días anteriores y Anteriores.

### Mejoras y correcciones

- Inicio de sesión de WeChat con QR: cuando te pide el código que aparece en tu teléfono, el código se verifica de inmediato en lugar de después de medio minuto aproximadamente. Si el código es incorrecto, te lo indica, y demasiados intentos fallidos generan un nuevo código QR.
- El menú de la cuenta es tan ancho como el área de la cuenta, y al pasar el cursor solo se oscurece el avatar. La navegación de los ajustes ocupa toda la barra lateral, con el área de la cuenta fija en la parte inferior.
- Las sugerencias para empezar de los bots con interfaz propia son una fila de botones compactos de una sola línea; pasa el cursor por encima de una larga para leerla completa.

## 0.1.29 - 2026-11-09

### Novedades

- **Descarga automática de actualizaciones, activada de forma predeterminada:** las apps de escritorio instaladas descargan las nuevas versiones en segundo plano y luego ofrecen Reiniciar y actualizar en la barra lateral y en Ajustes → Acerca de. Desactiva las descargas automáticas en Ajustes → General para descargar manualmente.
- La instalación requiere tu clic y espera a que no tengas chats activos ni tareas en segundo plano. Al salir de forma normal, las actualizaciones no se instalan automáticamente.
- Quienes tengan la 0.1.28 o una anterior deben instalar manualmente esta versión una vez antes de poder usar las actualizaciones desde la app. Disponible en macOS, Windows y AppImage de Linux; las instalaciones con Docker o desde el código fuente se siguen actualizando manualmente.
- **De vuelta a la app después de iniciar sesión:** después de aprobar en el navegador, la página espera a que la app esté realmente conectada antes de indicar que iniciaste sesión, y luego te lleva de vuelta a AnyModelBot. Si algo falla, te dice por qué. La página de clave de API también te permite iniciar sesión con una cuenta de Modelflare en su lugar.
- **Un modelo elegido para tu primer inicio de sesión:** si todavía no tienes un modelo predeterminado, la app elige un modelo de bajo costo que admita herramientas (con preferencia por DeepSeek), para que el crédito de prueba alcance para algunas tareas típicas. Si ninguno encaja, te explica por qué y te deja elegir.
- **En macOS, los permisos de uso de la computadora se piden solo cuando hacen falta:** la primera vez que un bot necesita hacer clic, escribir o mirar la pantalla sin el permiso de Accesibilidad o de Grabación de pantalla, ese turno se detiene y el chat indica qué permiso falta, con botones para solicitarlo, abrir la página de ajustes correspondiente y volver a comprobar. Si hay que volver a abrir la app, se conservan los borradores sin enviar.
- **Portadas en Descubrir:** los bots oficiales ahora tienen escenas de portada ilustradas que siguen el tema claro u oscuro, y los bots destacados se muestran como tarjetas grandes.

### Mejoras y correcciones

- Mensajes de error más claros: el saldo bajo, las credenciales vencidas, los modelos no disponibles, los límites de solicitudes y los fallos de red tienen cada uno su propia explicación y una acción correspondiente, como Recargar o cambiar de modelo. El error original queda en Detalles del error y se puede copiar sin los datos secretos. El mismo error ya no aparece dos veces, la barra lateral solo muestra “Falló: motivo”, y Volver a enviar advierte que toda la tarea se vuelve a ejecutar desde el principio. El bot Análisis de empresas agrupa los errores de sus tareas de la misma forma.
- El área de la cuenta, abajo a la izquierda, siempre muestra tu saldo y un enlace Recargar, y el saldo bajo se señala ahí en lugar de en un aviso aparte dentro de la app. Su menú incluye comentarios, buscar actualizaciones y cerrar sesión; si cierras sesión con tareas en curso, primero te pregunta. Con tu propia clave de API, puedes iniciar sesión en Modelflare desde aquí y conservar tus claves y ajustes.
- Lista de primeros pasos: “Conecta tu app de chat habitual” te permite elegir un canal y abre sus ajustes, y solo cuenta cuando está realmente conectado. “Saluda” necesita una respuesta real. Después de decir “recuerda …”, la lista se actualiza en segundos. Las indicaciones ya no aparecen mientras tienes un borrador o hay una tarea en curso, y la lista se pliega cuando todo está hecho.
- Después de reemplazar una clave o cambiar la fuente de modelos, la app te recuerda revisar los modelos de tus bots existentes. Durante la primera configuración no muestra este aviso.
- Guardar los ajustes del bot varias veces seguidas muestra un solo “Guardado”. Los bots nuevos mantienen contraídos los ajustes de modelo, con el modelo predeterminado heredado a la vista, y ya no eligen en silencio el primer modelo de la lista. Al crear un grupo con varios bots se explica cómo funciona, con ejemplos de mensajes basados en sus miembros.
- Hacer clic en Descubrir mientras buscas te lleva de vuelta a Descubrir.
- Los bots con interfaz propia (Análisis de empresas, PPT Master, Estudio de cine, Acciones de EE. UU.) ahora usan el mismo cuadro de mensaje que los chats normales. Las sugerencias para empezar son una fila de tarjetas, así que las largas ya no se cortan. La última respuesta se muestra como Markdown, las respuestas largas se pueden expandir y puedes abrir la conversación completa.
- Una interfaz más limpia: menos líneas divisorias y bordes, campos de entrada con fondo relleno y filas fijas de Te necesita y Descubrir en la barra lateral, con un punto azul en lugar de un contador (el número sigue apareciendo en el texto emergente y para los lectores de pantalla).
- Bordes más limpios en los avatares de los bots: desapareció el halo claro alrededor de los avatares sobre fondos oscuros, y los avatares pequeños ahora usan imágenes preescaladas para su tamaño, así que los bordes se ven más suaves.
- Antes de cada versión se comprueba que los instaladores de macOS tengan la firma de Developer ID y la notarización de Apple, y no se publican si alguna de las dos comprobaciones falla.

## 0.1.28 - 2026-11-08

### Novedades

- **Los bots oficiales vienen con la app:** Análisis de empresas, PPT Master, Estudio de cine y Acciones de EE. UU. incluyen en el instalador sus interfaces, ejemplos, personalidades y habilidades. La primera vista previa y la instalación no requieren descargar paquetes de bots. Las llamadas a los modelos y la investigación en línea siguen necesitando conexión a internet.

### Mejoras y correcciones

- Se corrigió el contenido recortado de los bots del catálogo y la falta de desplazamiento. El cuadro de entrada ya no tapa el contenido, y las actualizaciones conservan los proyectos y datos existentes.
- Las compilaciones de publicación reutilizan los datos de sumas de verificación incluidos en Electron para reducir los errores por tiempo de espera de red al descargar los archivos de sumas de verificación, sin dejar de verificar todos los hashes.
- Las compilaciones de macOS en GitHub, tanto para Intel como para Apple silicon, ahora recurren a TCP para los servicios de Apple, para evitar los cortes de conexión conocidos de HTTP/3. La firma, las marcas de tiempo y la notarización siguen siendo obligatorias.

## 0.1.27 - 2026-11-08

### Novedades

- **Los bots oficiales vienen con la app:** Análisis de empresas, PPT Master, Estudio de cine y Acciones de EE. UU. incluyen en el instalador sus interfaces, ejemplos, personalidades y habilidades. La primera vista previa y la instalación no requieren descargar paquetes de bots. Las llamadas a los modelos y la investigación en línea siguen necesitando conexión a internet.

### Mejoras y correcciones

- Se corrigió el contenido recortado de los bots del catálogo y la falta de desplazamiento. El cuadro de entrada ya no tapa el contenido, y las actualizaciones conservan los proyectos y datos existentes.
- Las compilaciones de publicación reutilizan los datos de sumas de verificación incluidos en Electron para reducir los errores por tiempo de espera de red al descargar los archivos de sumas de verificación, sin dejar de verificar todos los hashes.
- Las compilaciones de GitHub para Mac con Intel ahora recurren a TCP para los servicios de Apple, para evitar los cortes de conexión conocidos de HTTP/3. La firma, las marcas de tiempo y la notarización siguen siendo obligatorias.

## 0.1.26 - 2026-11-08

### Novedades

- **Los bots oficiales vienen con la app:** Análisis de empresas, PPT Master, Estudio de cine y Acciones de EE. UU. incluyen en el instalador sus interfaces, ejemplos, personalidades y habilidades. La primera vista previa y la instalación no requieren descargar paquetes de bots. Las llamadas a los modelos y la investigación en línea siguen necesitando conexión a internet.

### Mejoras y correcciones

- Se corrigió el contenido recortado de los bots del catálogo y la falta de desplazamiento. El cuadro de entrada ya no tapa el contenido, y las actualizaciones conservan los proyectos y datos existentes.
- Las compilaciones de publicación reutilizan los datos de sumas de verificación incluidos en Electron para reducir los errores por tiempo de espera de red al descargar los archivos de sumas de verificación, sin dejar de verificar todos los hashes.

## 0.1.25 - 2026-11-08

### Novedades

- **Los bots oficiales vienen con la app:** Análisis de empresas, PPT Master, Estudio de cine y Acciones de EE. UU. incluyen en el instalador sus interfaces, ejemplos, personalidades y habilidades. La primera vista previa y la instalación ya no descargan paquetes de bots; las actualizaciones llegan con las versiones de la app. Las llamadas a los modelos y la investigación en línea siguen necesitando conexión a internet.

### Mejoras y correcciones

- Se corrigió que el contenido de los bots del catálogo quedara recortado en una franja estrecha en la parte superior, con un gran espacio en blanco debajo y sin desplazamiento. Ahora el contenido ocupa todo el espacio disponible y el cuadro de entrada ya no lo tapa.
- Las actualizaciones de la app conservan los proyectos y datos existentes de los bots, y solo cambian a la interfaz actualizada cuando está lista, lo que evita una vista en blanco.

## 0.1.24 - 2026-11-07

### Novedades

- **Importar habilidades desde un ZIP:** en Ajustes del bot → Habilidades, importa un ZIP que contenga `SKILL.md`, revisa su nombre y su descripción, y agrégalo. Puedes ver, activar, desactivar o eliminar habilidades, y confirmar el reemplazo al importar otra vez el mismo nombre. Se conservan los scripts, las referencias y los recursos.
- **Búsqueda en el historial de chats:** desde la barra lateral, busca en los mensajes guardados en este dispositivo, filtra por bot, conversación, canal o fecha, y salta al mensaje original. `Ctrl/Cmd+Shift+F` abre la búsqueda global; `Ctrl/Cmd+F` busca en el chat actual, incluido el historial que aún no se ha cargado. La búsqueda no hace llamadas a modelos.
- Las habilidades se administran por separado para cada bot y los cambios se aplican cuando el bot está inactivo. El reemplazo conserva el estado de activación, la eliminación mantiene lo ya generado en el espacio de trabajo, y los paquetes importados no pueden sobrescribir las habilidades integradas ni las de los bots del catálogo.

## 0.1.23 - 2026-11-06

### Novedades

- Se agregó el bot del catálogo Estudio de cine para videos cortos, series por episodios, bibliotecas de recursos, storyboards, lienzos, narración, subtítulos y renderizado local. Las reglas creativas y el motor de composición están adaptados de PRINTFILM (MIT).
- Los bots del catálogo pueden previsualizar audio y video y conservar tomas multimedia. Los ID de generación persistentes permiten que un trabajo interrumpido recupere la tarea original sin volver a enviarla automáticamente.
- Se restablecieron las descargas de bots en Descubrir. Actualiza a la 0.1.23 para usar la nueva clave de firma del catálogo.

## 0.1.22 - 2026-11-04

### Novedades

- **Usa tus propias claves de API oficiales:** ya no necesitas una cuenta. En el primer inicio, haz clic en Usar tu propia clave de API, o ve a Ajustes → Modelos e ingresa una clave de OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Kimi, GLM, Qwen, MiniMax o Mistral. Las solicitudes a los modelos van directamente al proveedor, el proveedor te factura y la clave se queda en este dispositivo. La generación de imágenes y video sigue disponible solo con Modelflare.
- **Keenable para la búsqueda web:** elígelo en Ajustes → Red y acceso e ingresa una clave.

### Mejoras y correcciones

- La pestaña Modelflare de Ajustes ahora se llama Modelos, y desde ahí puedes iniciar sesión en Modelflare si aún no lo hiciste.
- Análisis de empresas, Acciones de EE. UU. y PPT Master ahora están disponibles en japonés, coreano y ruso.

### Privacidad

- Si solo usas claves de API oficiales y no inicias sesión, la app no lee los datos de tu cuenta de Modelflare ni su catálogo de precios. El gateway integrado lee el catálogo público de modelos de models.dev, y esa solicitud no lleva claves ni contenido de las conversaciones.

## 0.1.21 - 2026-11-03

### Novedades

- **Configuración de canales más fácil:** se rehízo Conexiones en Ajustes. Cada app muestra cómo conectarla, así que solo tienes que seguir los pasos para escanear un código o ingresar un token. Si todavía está esperando un primer mensaje para terminar de vincularse, te lo indica. También puedes agregar más cuentas para la misma app.

### Mejoras y correcciones

- **Eliminación de bots más clara:** la confirmación ahora indica qué bot responderá después en los canales de chat de ese bot. Si es tu último bot, te advierte que esos mensajes no recibirán respuesta.
- **Quitar bots de Descubrir:** una casilla en la misma confirmación te permite conservar los datos del bot.
- **Aspecto más limpio:** el fondo de la ventana ya no tiene resplandor, las acciones usan colores neutros y los tamaños de fuente ya no usan medios píxeles, así que el texto se ve más nítido en Windows.
- **Alerta de saldo:** cuando tu saldo baja, la barra lateral simplemente lo indica. Selecciona tu avatar para ver el importe.
- **El efecto de vidrio esmerilado sigue a tu sistema:** se quitó el ajuste, y la app ahora sigue la opción de reducir la transparencia de tu sistema.
- Mientras creas un bot, la barra lateral muestra su avatar y su nombre a medida que escribes, y al terminar ya no salta momentáneamente a otro bot.
- Los menús desplegables ahora acompañan a la página cuando se desplaza, y se refinó el diseño de Descubrir.

## 0.1.20 - 2026-11-03

### Novedades

- **Descubrir:** la barra lateral ahora tiene Descubrir, con bots listos para usar que tienen cada uno su propia vista. Al abrir uno ves un ejemplo, y solo se instala cuando envías tu primer mensaje. Quítalo cuando quieras.
- **Análisis de empresas:** dale el nombre de una empresa e investiga sus finanzas, noticias, sector y negocio, y luego escribe un informe con enlaces a las fuentes de los datos clave. Puede exportar un PDF si Python está instalado.
- **Acciones de EE. UU.:** escribe informes de investigación a partir de los documentos presentados ante la SEC, con cada cifra rastreable hasta su origen.
- **PPT Master:** convierte documentos o temas en presentaciones PPTX editables, y también puede crear plantillas o editar las presentaciones que ya tienes. Necesita Python.
- **12 avatares de expertos:** el selector de avatares ahora tiene personajes de 12 áreas, entre ellas derecho, salud, finanzas, programación y diseño.

### Privacidad

- Al iniciar y cada 6 horas, la app lee el catálogo de bots de anymodel.bot, y descarga el paquete de un bot cuando lo abres o lo usas. Estas solicitudes solo descargan; tus datos no se suben. Para desactivar el catálogo, define la variable de entorno `AMB_CATALOG=off`.

## 0.1.19 - 2026-11-03

### Cambios importantes

- **Ahora es obligatorio iniciar sesión:** ya no se admite pegar una clave de API; todos inician sesión con una cuenta de Modelflare. Después de actualizar, cualquier clave que hayas ingresado antes se elimina de este dispositivo y la app te pide iniciar sesión. Tus bots y conversaciones siguen funcionando una vez que lo hagas.
- **El inicio de sesión ahora funciona en Docker y en instalaciones remotas:** inicia sesión desde un navegador en cualquier dispositivo y luego pega en la app el enlace de la barra de direcciones. Durante la configuración por línea de comandos, escribe `remote`.

### Novedades

- **Esfuerzo de razonamiento:** elige Automático, Bajo, Medio o Alto. Los niveles más altos piensan más y responden más despacio. Con Automático decide el modelo, y los modelos que no permiten ajustarlo no se ven afectados.
- **Más detalle al probar un modelo:** la sección Solución de problemas ahora muestra por separado los resultados del gateway integrado y del endpoint directo, con el código de estado, el tiempo que tardó y el error original.

### Mejoras y correcciones

- Si el endpoint de la lista de modelos no responde, la app deja de esperar a los 30 segundos, así que “Probar modelo” ya no se queda cargando indefinidamente.
- Se actualizaron la página de socios, la página de inicio y la página de descargas del sitio web.

## 0.1.18 - 2026-11-03

### Novedades

- Esta versión incluye la compatibilidad completa con cinco idiomas, la selección manual del dominio de API y las pruebas de latencia, los recordatorios de actualización, el diagnóstico del proxy local y las actualizaciones del sitio web, la página de descargas y la página de socios. Consulta la sección 0.1.17 más abajo para conocer los detalles de cada función.

### Correcciones

- Se corrigió una comprobación de la documentación que identificaba mal el contenido de la hoja de ruta en copias de trabajo de Windows con finales de línea CRLF. Ahora hay pruebas de regresión para LF, CRLF y CR. Esta corrección no cambia el comportamiento de la aplicación.

## 0.1.17 - 2026-11-03

### Novedades

- **Cinco idiomas:** el japonés, el coreano y el ruso se suman al chino simplificado y al inglés en toda la app, la bandeja del sistema, los mensajes del sistema, las solicitudes de autorización, el sitio web y la documentación. Cambia de idioma durante la configuración inicial, en Ajustes o desde la paleta de comandos.
- **Dominios de API y pruebas de latencia:** elige manualmente `modelflare.dev`, `origin.modelflare.dev` o `cf.modelflare.dev` y compara los tiempos de respuesta desde el dispositivo donde se ejecuta la app. Las pruebas no envían ninguna clave de API, no hacen llamadas a modelos y nunca cambian de dominio automáticamente.
- **Recordatorios de actualización:** la barra lateral y la página Acerca de muestran las actualizaciones disponibles. Abre la página de descargas o descarta el recordatorio para esa versión.
- **Página de socios en el sitio web:** infórmate sobre las alianzas y completa una solicitud. Si no hay un endpoint de envío, el formulario indica claramente que usa el correo electrónico, en lugar de afirmar que la solicitud se envió.

### Mejoras y correcciones

- Los archivos de traducción están organizados por módulo. Las comprobaciones previas a cada versión validan el contenido faltante, los marcadores de posición, los plurales y los enlaces de la documentación. Se mejoraron los plurales en ruso, los importes y las fechas localizados, los métodos de entrada de japonés y coreano, y los saltos de línea en teléfonos.
- Los errores de autorización de Feishu y Notion siguen el idioma actual. Las conexiones rechazadas a un proxy local ahora incluyen indicaciones prácticas y conservan el error original.
- Se refinaron los efectos de cielo del sitio web, la página de descargas y los diseños para teléfonos, con imágenes para compartir localizadas, anotaciones de idioma para los buscadores y páginas 404.

## 0.1.16 - 2026-11-02

### Novedades

- **Chats grupales:** con dos o más bots, haz clic en ＋ en la barra lateral para crear un chat grupal y hablar con varios bots a la vez. Responde el bot al que mencionas con @; si no mencionas a ninguno, continúa el último que respondió. Los bots también pueden mencionar con @ a otro miembro para pasarle el relevo. Cada bot conserva su propio modelo, espacio de trabajo y memoria, y los costos se registran por bot.

### Cambios

- **El saldo ya no estorba:** la esquina inferior izquierda ahora solo muestra tu avatar, tu nombre y el botón de ajustes. Haz clic en el avatar para ver tu saldo y recargar. Sigues recibiendo un recordatorio en la barra lateral cuando tu saldo baja del nivel de alerta.

## 0.1.15 - 2026-11-02

### Novedades

- **Cuentas compartidas por todos los bots:** agrega una sola vez tus cuentas de chat y de Notion en Ajustes › Conexiones, y todos los bots podrán usarlas. Cada servicio puede tener varias cuentas, cada una con su propio alias.
- **Cambia de bot desde un chat:** envía `/bot` en una app de chat para ver tus bots, y `/bot nombre` una vez para cambiar. Ese chat se queda con el nuevo bot, así que no tienes que repetirlo en cada mensaje. Cada bot también conoce a los demás, así que puede responderte cuando le preguntes.
- **Telegram, Slack y Discord:** pega un token para conectarlos. No hace falta una dirección pública, y las imágenes y los archivos funcionan en ambos sentidos.
- **Notion:** conéctalo con autorización en un clic o con un token. Los bots pueden buscar, leer, crear y editar páginas, y consultar bases de datos. No pueden eliminar páginas.
- **Leer mensajes de Feishu:** autoriza con un código QR y luego pídele a cualquier bot que “revise mi segundo Feishu”. Lee los chats y busca mensajes en tu nombre, en modo de solo lectura.
- **Agrega Feishu escaneando un código:** al agregar una cuenta de chat de Feishu, escanea un código QR para crear la app en lugar de ingresar un App ID y un Secret.

### Mejoras

- **La búsqueda web ya no necesita una clave de DeepSeek:** es gratis de forma predeterminada, y puedes cambiar a Tavily, Exa, Bocha, Zhipu o tu propio SearXNG.
- **Los personajes son independientes de los roles:** un avatar solo define el aspecto de un bot, y elegir una plantilla no lo cambia.

### Cambios

- La configuración de los canales de chat pasó del panel de información de cada bot a Ajustes › Conexiones. Las cuentas existentes se trasladan automáticamente sin volver a iniciar sesión, y el mismo bot sigue respondiendo de forma predeterminada.
- Los propietarios y las listas de permitidos ahora pertenecen a la cuenta, así que cualquier persona autorizada en ella puede hablar con cualquier bot. Eliminar un bot ya no afecta a las cuentas.
