// 导航、页脚和 FAQ 里的"文档"：指向 AnyModelBot 自己的 README（中英文各一份），不是 Modelflare 的 API 文档。
// README 讲下载、功能、隐私和参与贡献；更细的开发说明在仓库的 docs/ 里，从 README 能点过去。
import type { Lang } from "../i18n";
import { GITHUB_URL } from "./site";

export const docsUrl = (lang: Lang) => (lang === "zh" ? `${GITHUB_URL}#readme` : `${GITHUB_URL}/blob/master/README_en.md`);
