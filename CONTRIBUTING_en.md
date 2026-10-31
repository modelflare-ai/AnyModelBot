# Contributing

[简体中文](./CONTRIBUTING.md) | English

Thanks for helping make AnyModelBot better. Bug reports, fixes, docs and ideas are all welcome.

## Questions and feedback

- **Questions, ideas, show and tell:** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bugs and feature requests:** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues), using the templates
- **Security problems:** do not open a public issue; report privately as described in [SECURITY.md](./SECURITY.md)
- **Anything else:** email [support@anymodel.bot](mailto:support@anymodel.bot)

When reporting a bug, please include:

- The version (Settings → About), your operating system and architecture (for example Windows 11 x64, macOS 15 Apple silicon), and how you run it (desktop / command line / Docker)
- Steps to reproduce, what you expected and what happened
- Diagnostics: Settings → Troubleshooting → "Copy diagnostics" (API keys and tokens are replaced with `***`). Logs are in `logs/app.log` inside the data directory; see [docs/privacy_en.md](./docs/privacy_en.md#data-directory) for where that is
- The model ID, if the problem involves a specific model

## Development setup

Requires Node.js 22.13+ and Go 1.26.8+ (to compile the bundled magpie gateway).

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # fetch the vendor/magpie submodule and compile it into build/bin/
```

| Command | What it does |
| :--- | :--- |
| `npm start` | Run from the command line: gateway + bots + console at `http://127.0.0.1:3600/` |
| `npm run dev` | Same, restarting on code changes |
| `npm run electron:dev` | Desktop app in development mode |
| `npm run electron:smoke` | Desktop smoke test (uses xvfb-run on headless Linux) |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit tests + offline end-to-end + gateway integration tests |
| `npm run test:dsh-bundle` | Real DSH integration test under Electron (run `prepare:dsh` + `bundle:dsh` first) |
| `npm run docs:check` | README self-check |

Repository layout, packaging and channel setup are covered in the [development guide](./docs/development_en.md).

## Branches and pull requests

1. Fork the repo and create a branch from `master`.
2. Before you push, run:

   ```bash
   npm run typecheck && npm test
   ```

   If you changed the README or `docs/`, also run `npm run docs:check`.
3. Open a pull request against `master` describing what changed, why, and how you verified it. Include screenshots for UI changes.
4. For anything larger than a small fix (new features, architecture changes, new dependencies), open an issue first so we can agree on the approach before you invest the time.
5. Keep one change per PR; follow the existing commit style (`feat(scope): …`, `fix(scope): …`).

## UI changes

- Use the tokens and components in `ui/design` (see `ui/design/README.md`); no one-off colors or font sizes.
- The brand accent is fluorescent yellow-green `#d7ff00`; do not introduce blue into the UI.
- The console is Preact + htm with no build step; please do not add a bundler or front-end dependencies that need compiling.
- Check both the light and dark themes.
- Don't hard-code UI text: add it to `ui/locales/zh-CN/` and `ui/locales/en/` (both languages) and use `t()`; run `node scripts/i18n-check.mjs` before submitting. Check both languages — English is usually longer.

## Third-party code and dependencies

- When you add a dependency or port or adapt external code, update `THIRD_PARTY_NOTICES.md` with the source, version and license.
- Do not add components whose licenses are incompatible with MIT distribution, such as AGPL, SSPL or FSL.

## Code of conduct

Be kind and stick to the facts. Respect every participant and critique ideas, not people; harassment, personal attacks and discriminatory language are not accepted. Maintainers may remove content that does not meet these expectations. To raise a concern, email [support@anymodel.bot](mailto:support@anymodel.bot).

## License

Contributions you submit are released under this repository's [MIT License](./LICENSE).
