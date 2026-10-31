# 贡献指南

简体中文 | [English](./CONTRIBUTING_en.md)

谢谢你愿意帮 AnyModelBot 变得更好。bug 报告、修复、文档和想法都欢迎。

## 提问与反馈

- **提问、想法、使用交流：** [GitHub Discussions](https://github.com/modelflare-ai/AnyModelBot/discussions)
- **Bug 与功能建议：** [GitHub Issues](https://github.com/modelflare-ai/AnyModelBot/issues)，按模板填写
- **安全问题：** 不要公开提 issue，按 [SECURITY.md](./SECURITY.md) 私下报告
- **其他事情：** 发邮件到 [support@anymodel.bot](mailto:support@anymodel.bot)

提 bug 时请带上：

- 版本号（设置 → 关于）、操作系统与架构（例如 Windows 11 x64、macOS 15 Apple 芯片）、运行方式（桌面版 / 命令行 / Docker）
- 复现步骤、期望结果和实际结果
- 诊断信息：设置 → 故障排查 →「复制诊断信息」（API Key、令牌已替换成 `***`）。日志在数据目录的 `logs/app.log`，数据目录的位置见 [docs/privacy.md](./docs/privacy.md#数据目录)
- 涉及某个模型的问题，写上模型 ID

## 开发环境

需要 Node.js 22.13+ 和 Go 1.26.8+（编译内置网关 magpie）。

```bash
git clone https://github.com/modelflare-ai/AnyModelBot.git
cd AnyModelBot
npm install
npm run setup          # 拉取 vendor/magpie 子模块并编译到 build/bin/
```

| 命令 | 作用 |
| :--- | :--- |
| `npm start` | 命令行运行：内置网关 + 机器人 + 管理界面 `http://127.0.0.1:3600/` |
| `npm run dev` | 同上，改代码自动重启 |
| `npm run electron:dev` | 开发模式运行桌面版 |
| `npm run electron:smoke` | 桌面版冒烟测试（Linux 无显示器时自动用 xvfb-run） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 单元测试 + 离线端到端 + 内置网关集成测试 |
| `npm run test:dsh-bundle` | 用 Electron 跑真实 DSH 集成测试（需先 `prepare:dsh` + `bundle:dsh`） |
| `npm run docs:check` | README 自检 |

目录结构、打包、各渠道的配置方法见[开发文档](./docs/development.md)。

## 分支与 Pull Request

1. Fork 仓库，从 `master` 新建分支。
2. 提交前跑一遍：

   ```bash
   npm run typecheck && npm test
   ```

   改了 README 或 `docs/` 的话，再跑 `npm run docs:check`。
3. 向 `master` 提交 Pull Request，写清楚改了什么、为什么改、怎么验证的。界面改动请附截图。
4. 比小修复大的改动（新功能、改架构、加依赖），请先开 issue 对齐方案，免得白做。
5. 一个 PR 只做一件事；提交信息沿用仓库现有的风格（`feat(scope): …`、`fix(scope): …`）。

## 界面改动

- 沿用 `ui/design` 里的 tokens 和组件（说明见 `ui/design/README.md`），不写一次性的颜色、字号。
- 品牌强调色是荧光黄绿 `#d7ff00`，界面里不引入蓝色。
- 管理界面是 Preact + htm，没有构建步骤，请不要引入打包工具或需要编译的前端依赖。
- 浅色和深色主题都要看一遍。

## 第三方代码与依赖

- 新增依赖、移植或改编外部代码时，同步更新 `THIRD_PARTY_NOTICES.md`，写清来源、版本和许可证。
- 不引入 AGPL、SSPL、FSL 等与 MIT 分发不兼容的组件。

## 行为准则

友善、就事论事。尊重每一位参与者，对事不对人；不接受骚扰、人身攻击或歧视性言论。维护者可以删除不符合这些要求的内容。遇到问题可以发邮件到 [support@anymodel.bot](mailto:support@anymodel.bot)。

## 许可

你提交的贡献将按本仓库的 [MIT 许可证](./LICENSE)发布。
