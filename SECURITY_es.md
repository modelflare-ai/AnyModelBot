# Política de seguridad

[English / 简体中文](./SECURITY.md) | [繁體中文（台灣）](./SECURITY_zh-TW.md) | [日本語](./SECURITY_ja.md) | [한국어](./SECURITY_ko.md) | [Русский](./SECURITY_ru.md) | Español | [Português (Brasil)](./SECURITY_pt.md) | [Türkçe](./SECURITY_tr.md)

## Cómo reportar una vulnerabilidad

**No** abras un issue, una discusión ni un pull request públicos para un problema de seguridad.

Repórtalo de forma privada por alguna de estas vías:

1. **Reporte privado de vulnerabilidades de GitHub (preferido):** ve a la pestaña **Security** del repositorio → **Report a vulnerability**.
2. **Correo electrónico:** [support@anymodel.bot](mailto:support@anymodel.bot), con “Security” en el asunto.

Incluye:

- La versión de AnyModelBot (Ajustes → Acerca de), el sistema operativo y la arquitectura, y cómo lo ejecutas (escritorio / línea de comandos / Docker)
- En qué consiste el problema y qué podría hacer un atacante con él
- Los pasos para reproducirlo o una prueba de concepto
- Cualquier registro o diagnóstico que ayude (Ajustes → Solución de problemas → “Copiar diagnóstico” quita las claves y los tokens)

## Qué pasa después

1. Confirmamos que recibimos tu reporte.
2. Lo investigamos y te mantenemos al tanto de nuestra evaluación.
3. Acordamos contigo una corrección y un calendario de divulgación, y luego publicamos una versión con la corrección.
4. Con tu permiso, te damos crédito en las notas de la versión.

## Versiones con soporte

Las correcciones de seguridad se incluyen en la versión más reciente. Antes de reportar un problema, comprueba que siga ocurriendo en la [última versión](https://github.com/modelflare-ai/AnyModelBot/releases).

## Alcance

Dentro del alcance: la app AnyModelBot de este repositorio (app de escritorio, línea de comandos e imagen de Docker compilada a partir de este repositorio) y su consola local.

Fuera del alcance de esta política: los servicios propios de Modelflare (repórtalos a través del [Centro de confianza de Modelflare](https://modelflare.dev/trust?utm_source=anymodelbot&utm_campaign=amb_readme)), las plataformas WeChat y Feishu, y los proyectos de origen como magpie, DeepSeek Harness y Cua; repórtalos a sus responsables. Si tienes dudas, escríbenos por correo y lo derivaremos a quien corresponda.
