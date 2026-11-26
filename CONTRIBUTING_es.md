# Cómo contribuir

[简体中文](./CONTRIBUTING.md) | [繁體中文（台灣）](./CONTRIBUTING_zh-TW.md) | [English](./CONTRIBUTING_en.md) | [日本語](./CONTRIBUTING_ja.md) | [한국어](./CONTRIBUTING_ko.md) | [Русский](./CONTRIBUTING_ru.md) | Español | [Português (Brasil)](./CONTRIBUTING_pt.md) | [Türkçe](./CONTRIBUTING_tr.md)

Gracias por ayudar a mejorar AnyModelBot. Los reportes de errores, las correcciones, la documentación y las ideas son bienvenidos.

## Preguntas y comentarios

- **Preguntas, ideas y proyectos para compartir:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Errores y solicitudes de funciones:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues), usando las plantillas
- **Chat con la comunidad:** [Discord](https://discord.gg/umBN6wX3zJ) · [Telegram](https://t.me/+Tx6Payfzxqk2ZGVl)
- **Problemas de seguridad:** no abras un issue público; repórtalos de forma privada como se describe en la [política de seguridad](./SECURITY_es.md)
- **Cualquier otra cosa:** escribe a [support@anymodel.bot](mailto:support@anymodel.bot)

Al reportar un error, incluye:

- La versión (Ajustes → Acerca de), tu sistema operativo y arquitectura (por ejemplo, Windows 11 x64 o macOS 15 Apple silicon) y cómo lo ejecutas (escritorio / línea de comandos / Docker)
- Los pasos para reproducirlo, qué esperabas y qué ocurrió
- El diagnóstico: Ajustes → Solución de problemas → “Copiar diagnóstico” (las claves de API y los tokens se reemplazan por `***`). Los registros están en `logs/app.log` dentro de la carpeta de datos; consulta en [docs/privacy_es.md](./docs/privacy_es.md#carpeta-de-datos) dónde se encuentra
- El ID del modelo, si el problema tiene que ver con un modelo concreto

## Entorno de desarrollo

Requiere Node.js 22.13+ y Go 1.26.8+ (para compilar el gateway magpie integrado).

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # obtiene el submódulo vendor/magpie y lo compila en build/bin/
```

| Comando | Qué hace |
| :--- | :--- |
| `npm start` | Ejecuta desde la línea de comandos: gateway + bots + consola en `http://127.0.0.1:3600/` |
| `npm run dev` | Lo mismo, pero se reinicia al cambiar el código |
| `npm run electron:dev` | App de escritorio en modo de desarrollo |
| `npm run electron:smoke` | Prueba básica de la app de escritorio (usa xvfb-run en Linux sin pantalla) |
| `npm run typecheck` | Comprobación de tipos de TypeScript |
| `npm test` | Pruebas unitarias + pruebas de extremo a extremo sin conexión + pruebas de integración del gateway |
| `npm run test:dsh-bundle` | Prueba de integración con el DSH real bajo Electron (ejecuta antes `prepare:dsh` + `bundle:dsh`) |
| `npm run docs:check` | Autocomprobación del README |

La estructura del repositorio, el empaquetado y la configuración de canales se explican en la [guía de desarrollo](./docs/development_es.md).

## Ramas y pull requests

1. Haz un fork del repositorio y crea una rama a partir de `master`.
2. Antes de hacer push, ejecuta:

   ```bash
   npm run typecheck && npm test
   ```

   Si cambiaste el README o `docs/`, ejecuta también `npm run docs:check`.
3. Abre un pull request contra `master` en el que describas qué cambió, por qué y cómo lo verificaste. Incluye capturas de pantalla si hay cambios en la interfaz.
4. Para cualquier cambio mayor que una corrección pequeña (funciones nuevas, cambios de arquitectura, dependencias nuevas), abre primero un issue para que acordemos el enfoque antes de que inviertas tiempo.
5. Limita cada PR a un solo cambio y sigue el estilo de commits existente (`feat(scope): …`, `fix(scope): …`).

## Cambios en la interfaz

- Usa los tokens y componentes de `ui/design` (consulta `ui/design/README.md`); nada de colores ni tamaños de fuente ad hoc.
- El color de acento de la marca es el amarillo verdoso fluorescente `#d7ff00`; no introduzcas el azul en la interfaz.
- La consola usa Preact + htm sin paso de compilación; no agregues un empaquetador ni dependencias de front-end que necesiten compilación.
- Revisa tanto el tema claro como el oscuro.
- Usa `t()` para los textos de la interfaz. Añade las traducciones en `ui/locales/<idioma>/` para todos los idiomas del manifiesto, incluido `zh-TW` para chino tradicional (Taiwán). Ejecuta `npm run i18n:check` antes de enviar los cambios.

## Código y dependencias de terceros

- Cuando agregues una dependencia o portes o adaptes código externo, actualiza `THIRD_PARTY_NOTICES.md` con el origen, la versión y la licencia.
- No agregues componentes cuyas licencias sean incompatibles con la distribución bajo MIT, como AGPL, SSPL o FSL.

## Código de conducta

Sé amable y cíñete a los hechos. Respeta a cada participante y critica las ideas, no a las personas; no se aceptan el acoso, los ataques personales ni el lenguaje discriminatorio. Los responsables del proyecto pueden eliminar el contenido que no cumpla estas expectativas. Para plantear una inquietud, escribe a [support@anymodel.bot](mailto:support@anymodel.bot).

## Licencia

Las contribuciones que envíes se publican bajo la [licencia MIT](./LICENSE) de este repositorio.
