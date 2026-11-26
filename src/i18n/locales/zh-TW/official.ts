import type { TranslatedCatalog } from "../../index.js";

export default {
  invalid_key: "{name} 沒有接受這個 Key，請檢查後再試",
  rate_limited: "{name} 現在限流了，稍後再試",
  network: "連不上 {name}。如果這台裝置存取它需要代理，請先設定代理",
  upstream: "{name} 沒有返回模型清單：{detail}",
} satisfies TranslatedCatalog["official"];
