/** 一条文案：纯文本（可带 {占位符}），或按数量选的复数形式（count 参数，Intl.PluralRules 的类别） */
export type Msg = string | { one?: string; other: string };

/**
 * 一个命名空间的词典。zh 写成 `{ … } satisfies Catalog`，en 写成 `Catalog<typeof zh>`：
 * 键由 zh 推出，en 少键、多键都是类型错误。
 */
export type Catalog<T = Record<string, unknown>> = { [K in keyof T]: Msg };
