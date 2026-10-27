# 第三方声明 / Third-Party Notices

anymodel bot 自身以 MIT 许可发布（见 LICENSE）。以下组件随本程序分发或被移植，各自保留原许可。

未复制 Fei2411/DS-Bot 的任何代码（仅参考思路）；如将来复制，须在此添加其 Apache-2.0 声明。

## magpie（内置模型网关，以二进制形式随附）

来源：https://github.com/yetone/magpie （vendor/magpie 子模块，v0.1.1720）

```
MIT License

Copyright (c) 2026 yetone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## openclaw-weixin（微信 iLink 通道，src/channels/weixin 中的部分代码移植自此项目）

来源：https://github.com/Tencent/openclaw-weixin

```
Tencent is pleased to support the open source community by making openclaw-weixin available. 

Copyright (C) 2026 Tencent.  All rights reserved. 

openclaw-weixin is licensed under the MIT.


Terms of the MIT:
--------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## npm 依赖（运行时）

- @larksuiteoapi/node-sdk 1.76.0 — MIT
- preact 11.0.2 — MIT
- htm 3.1.1 — Apache-2.0
- qrcode 1.5.4 — MIT
- qrcode-terminal 0.12.0 — Apache-2.0（见包内 LICENSE）

传递依赖的许可证随各自包保存在 node_modules 中。桌面版另含 Electron（MIT）及 Chromium 等组件，其许可证位于安装目录的 LICENSE 与 LICENSES.chromium.html。
