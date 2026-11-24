export default {
  "h2": "Preguntas.",
  "h2dim": "Respuestas directas.",
  "ask": "¿Tienes una pregunta? Ábrela.",
  "more": "¿No la encontraste? Consulta la documentación",
  "community": "O pregunta en la comunidad",
  "items": [
    {
      "q": "¿Cómo agrego habilidades a un bot?",
      "a": "Hay cuatro formas: copia una instrucción de instalación de la biblioteca en Apps y habilidades o envíale al bot el enlace de GitHub de una habilidad, y confirma la tarjeta; importa un ZIP con un SKILL.md (hasta 20 MB) en los ajustes del bot → Habilidades → Importar ZIP; en la app de escritorio, importa desde Mi biblioteca de habilidades → Importar desde este equipo… las habilidades que Claude Code, Codex, Cursor y herramientas similares instalaron en este equipo, y actívalas en los bots que las necesiten; o, cuando un bot hace algo bien, di «guardar como habilidad» o envía /skill y confirma el borrador para guardarla en Mis habilidades, donde puedes activarla en otros bots, exportarla como ZIP o programarla. Los secretos nunca se escriben en una habilidad; el software y la conexión que necesita dependen de cada habilidad."
    },
    {
      "q": "¿Cómo encuentro una conversación anterior?",
      "a": "Busca en el historial de chats desde la barra lateral, o presiona Ctrl/Cmd+Shift+F para la búsqueda global y Ctrl/Cmd+F para el chat actual. Filtra por bot, conversación, canal o fecha, y selecciona un resultado para saltar al mensaje. La búsqueda solo abarca los registros guardados en este dispositivo y no hace llamadas a modelos."
    },
    {
      "q": "¿En qué se diferencia de Grok Bot, OpenAI dots o Claude Duet?",
      "a": "También trabajan para ti en segundo plano y te consultan cuando la decisión es tuya. La diferencia: AnyModelBot es de código abierto (MIT) y funciona en tu propia computadora o servidor. Es compatible con GPT, Claude, Gemini, Grok y más; la app es gratis y los modelos se cobran por uso, sin la suscripción de un único proveedor. El README en GitHub tiene una tabla comparativa completa. Grok Bot, dots y Claude Duet son productos de xAI, OpenAI y Anthropic, respectivamente; AnyModelBot no tiene relación con ellos."
    },
    {
      "q": "¿Qué diferencia hay entre los seis personajes?",
      "a": "Solo el nombre y el aspecto. Ninguno tiene un trabajo fijo. El avatar solo te ayuda a distinguir tus bots de un vistazo. Tú eliges el nombre, la personalidad, el modelo y el espacio de trabajo, y todos los bots pueden chatear, hacer trabajo en tu computadora y recordar cosas. Las plantillas de la app son solo un punto de partida: puedes cambiar cada palabra o empezar desde cero."
    },
    {
      "q": "¿Mis datos se suben a sus servidores?",
      "a": "Los chats, la memoria, los archivos y las claves se guardan en tu dispositivo. Las solicitudes a los modelos van al proveedor que elijas: directamente si usas tu propia clave de API oficial; si no, a través de Modelflare, donde la retención de registros sigue su documento “Retención de datos”. El contenido de la pantalla que se ve durante el uso de la computadora se envía al modelo elegido."
    },
    {
      "q": "¿Funciona sin conexión?",
      "a": "No. Los modelos vienen de Modelflare o de las API oficiales de los proveedores; no se admiten modelos locales."
    },
    {
      "q": "¿Puedo usarlo en el teléfono?",
      "a": "Todavía no hay una app independiente; chatea con él en Slack, Telegram o Discord."
    },
    {
      "q": "¿Una cuenta de chat puede hablar con varios bots?",
      "a": "Sí. Agrega la cuenta una vez en Ajustes › Canales de chat y todos los bots la comparten. Cada servicio puede tener varias cuentas, cada una con un alias. Un bot predeterminado responde los chats nuevos; envía /bot y un nombre una vez para cambiar, y ese chat se queda con el nuevo bot. Envía /bot para ver tus bots."
    },
    {
      "q": "¿Los bots pueden trabajar con mis apps, como Notion o GitHub?",
      "a": "Sí, una vez que las conectes. Usa Apps y habilidades en el menú del avatar: GitHub, Notion, Linear, Atlassian y Canva vienen integrados, y puedes agregar conectores MCP personalizados. Puedes conectar varias cuentas de la misma app y preguntarle a cualquier bot por ellas usando su número o alias. Las herramientas de solo lectura se ejecutan de inmediato, las escrituras te preguntan primero, y las eliminaciones o cualquier cosa que se envíe a otras personas siempre preguntan. Los bots de solo lectura solo pueden leer."
    },
    {
      "q": "¿Y si no tengo cuenta de Modelflare?",
      "a": "La primera vez que abras la app, haz clic en Iniciar sesión / Registrarse en Modelflare y regístrate en tu navegador. La app se conecta sola cuando vuelves, sin claves que copiar. En Docker o en un servidor remoto, pega el enlace al que llegas después de iniciar sesión. Los tres dominios de API están disponibles; compara los tiempos de respuesta y elige uno en Ajustes. También puedes prescindir de la cuenta: haz clic en Usar tu propia clave de API e ingresa una clave oficial de OpenAI, Anthropic, Google Gemini, DeepSeek u otro proveedor, y las solicitudes a los modelos irán directamente a ellos."
    },
    {
      "q": "¿Es seguro el uso de la computadora?",
      "a": "Está limitado a 24 acciones permitidas; se ejecuta automáticamente de forma predeterminada y se puede cambiar para que pregunte antes de las acciones que modifican la interfaz; el contenido de la pantalla va al modelo; pruébalo primero en una computadora o una cuenta dedicada."
    },
    {
      "q": "¿Cómo verifico una descarga?",
      "a": "Cada descarga muestra un SHA-256; usa Get-FileHash en Windows y shasum -a 256 en macOS/Linux. Las versiones de GitHub también incluyen un archivo SHA256SUMS que puedes comprobar de una vez con sha256sum -c."
    },
    {
      "q": "¿El bot sigue ahí si cierro la ventana?",
      "a": "Al cerrar la ventana, sigue en la bandeja del sistema (opcionalmente, puede abrirse al iniciar sesión); se desconecta cuando la computadora está apagada o en reposo; usa Docker si lo quieres siempre activo."
    },
    {
      "q": "¿Recopilan telemetría?",
      "a": "Lo que podemos confirmar: la telemetría del controlador de uso de la computadora (Cua) está desactivada y la actualización automática de magpie está deshabilitada. Consulta el diagrama de flujo de datos para ver cómo viajan las solicitudes a los modelos. El código tiene licencia MIT: léelo tú mismo."
    }
  ]
};
