/**
 * 交给代理模型的提示词都在这个目录：系统提示词（system.ts）、每段第一条消息（segment.ts）、技能说明（skills.ts）。
 * 工具说明在 dsh-runtime/plugins/*.mjs 里，和工具定义放在一起。
 */
export * from "./system.js";
export * from "./segment.js";
export * from "./skills.js";
