# Security Policy · 安全策略

[English](#english) | [简体中文](#简体中文)

## English

### Reporting a vulnerability

Please **do not** open a public issue, discussion or pull request for a security problem.

Report it privately in one of these ways:

1. **GitHub private vulnerability reporting (preferred):** go to the repository's **Security** tab → **Report a vulnerability**.
2. **Email:** [support@anymodel.bot](mailto:support@anymodel.bot), with "Security" in the subject line.

Please include:

- The AnyModelBot version (Settings → About), operating system and architecture, and how you run it (desktop / command line / Docker)
- What the problem is and what an attacker could do with it
- Steps to reproduce or a proof of concept
- Any logs or diagnostics that help (Settings → Troubleshooting → "Copy diagnostics" removes keys and tokens)

### What happens next

1. We confirm we have received your report.
2. We investigate and keep you updated on our assessment.
3. We agree with you on a fix and a disclosure timeline, then publish a fixed release.
4. With your permission, we credit you in the release notes.

### Supported versions

Security fixes go into the latest release. Please check that the problem still exists in the [latest release](https://github.com/modelflare-ai/AnyModelBot/releases) before reporting.

### Scope

In scope: the AnyModelBot app in this repository (desktop app, command line, Docker image built from this repository) and its local console.

Out of scope here: Modelflare's own services (report those through the [Modelflare Trust Center](https://modelflare.dev/trust)), WeChat and Feishu platforms, and upstream projects such as magpie, DeepSeek Harness and Cua — please report those to their maintainers. If you are unsure, email us and we will route it.

## 简体中文

### 报告漏洞

安全问题请**不要**公开提 issue、讨论或 Pull Request。

请通过以下任一方式私下报告：

1. **GitHub 私密漏洞报告（推荐）：** 在仓库的 **Security** 页 → **Report a vulnerability** 提交。
2. **邮件：** [support@anymodel.bot](mailto:support@anymodel.bot)，标题里写上「Security」。

请提供：

- AnyModelBot 版本（设置 → 关于）、操作系统与架构、运行方式（桌面版 / 命令行 / Docker）
- 问题是什么，攻击者能借此做什么
- 复现步骤或概念验证
- 有帮助的日志或诊断信息（设置 → 故障排查 →「复制诊断信息」会去掉密钥和令牌）

### 之后的流程

1. 我们确认收到你的报告。
2. 我们调查并告诉你评估结果和进展。
3. 和你商定修复方案与披露时间，然后发布修复版本。
4. 经你同意，在发布说明里致谢。

### 支持的版本

安全修复进入最新版本。报告前请先确认问题在[最新版本](https://github.com/modelflare-ai/AnyModelBot/releases)里仍然存在。

### 范围

范围内：本仓库的 AnyModelBot 应用（桌面版、命令行、用本仓库构建的 Docker 镜像）及其本地控制台。

不在这里处理：Modelflare 自身的服务（请通过 [Modelflare 信任中心](https://modelflare.dev/trust)报告）、微信与飞书平台，以及 magpie、DeepSeek Harness、Cua 等上游项目——请报告给它们的维护者。拿不准的话，发邮件给我们，我们帮你转。
