# 新手引导 · 可交互原型

App 内新手引导（上手清单 6 步 + 随用随教的小提示）的可点击原型，风格与官网一致。静态设计稿在 claude.ai 的画布上（AnyModelBot 新手引导），这里是它会动的版本。

- 页面：`index.html`（目录）、`Main.html`、`Step2-Model.html` … `Step6-Media.html`、`Tips.html`。布局沿用设计稿的内联样式。
- `css/bots.css`、`js/eyes.js`：机器人头像与动效，来自官网（`site/src/styles/bots.css`、`site/src/lib/eyes.ts` 用 esbuild 转出），改动请回源文件再同步。
- `js/bots.js`：把 `<span class="face" data-char="blue" style="width: …">` 渲染成会动的头像。
- `css/proto.css`、`js/proto.js`：引导的动效与公共交互（聚光、引导卡片进出场、左下角清单与进度、吐司、彩带、流式回复）。
- `js/page-*.js`：每一页自己的流程。
- 字体用 `assets/fonts` 里自带的 Geist（不连 Google Fonts，大陆打开不会卡住）；中文落到系统字体。

## 预览

服务器上用独立的静态服务提供（不经过 Caddy，不影响其他站点）：

```bash
# /site/ 是官网的预览构建，同步原型时别把它删了
rsync -a --delete --exclude /site/ anymodelbot_design/onboarding/ /srv/amb-preview/ && chmod -R a+rX /srv/amb-preview
# 打开 http://64.83.27.22:18600/（官网预览在 /site/），防火墙 ufw 放行 18600/tcp
```

服务是 systemd 临时单元 `amb-preview`，跑的是 `site/scripts/preview-serve.py`（gzip、HTTP/1.1 长连接、缓存头和线上 nginx 一致；`python3 -m http.server` 不压缩、每个请求都重新建连接，远程打开很慢）。单元是临时的，服务器重启后要重新起：

```bash
install -D -m 0644 site/scripts/preview-serve.py /usr/local/lib/amb-preview/preview-serve.py
systemd-run --unit amb-preview --description "AnyModelBot design preview (static, :18600, gzip)" \
  -p DynamicUser=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes -p NoNewPrivileges=yes -p Restart=on-failure \
  /usr/bin/python3 -I /usr/local/lib/amb-preview/preview-serve.py --port 18600 --bind 0.0.0.0 --directory /srv/amb-preview
```

`/assets/bots/*.webp` 用的是站点根路径，所以要从目录根提供服务（直接双击打开 html 文件时头像不显示）。
