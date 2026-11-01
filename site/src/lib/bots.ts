// 六个毛绒机器人：几何移植自 App 的 ui/components/avatar.js（BOT_CHARS），单位是相对头像方框的百分比。
// App 改了几何后 `npm run sync` 会警告，届时把新值抄过来并更新 BOT_CHARS_HASH。
export type CharKey = "blue" | "yellow" | "green" | "red" | "purple" | "orange";
type Pt = [number, number];
export interface CharGeo { eyes: [Pt, Pt]; r: number; earL: Pt; earR: Pt; top: Pt; tip: Pt; lens?: [Pt, Pt, number] }

export const BOT_CHARS: Record<CharKey, CharGeo> = {
  blue: { eyes: [[38.81, 62.99], [60.82, 62.99]], r: 3.41, earL: [18.14, 62.21], earR: [81.94, 62.21], top: [49.96, 31.78], tip: [49.8, 21.2] },
  yellow: { eyes: [[38.34, 63.5], [61.4, 63.48]], r: 3.57, earL: [17.91, 62.13], earR: [82.25, 62.13], top: [50.04, 31.32], tip: [50, 19.7] },
  green: { eyes: [[38.8, 63.07], [61.09, 63.08]], r: 3.49, earL: [17.91, 62.71], earR: [82.02, 62.71], top: [50, 31.32], tip: [50.2, 21.2] },
  red: { eyes: [[37.53, 59.46], [62.24, 59.45]], r: 3.88, earL: [19.53, 58.06], earR: [80.47, 58.06], top: [50.04, 28.37], tip: [50, 15] },
  purple: { eyes: [[38.86, 63.04], [60.96, 63.04]], r: 3.49, earL: [18.14, 62.91], earR: [81.94, 62.91], top: [49.84, 32.87], tip: [50, 22] },
  orange: {
    eyes: [[38.18, 61.84], [61.83, 61.84]], r: 3.57, earL: [15.66, 61.47], earR: [84.34, 61.47], top: [50.12, 27.44], tip: [50, 17],
    lens: [[35.27, 40.85], [64.81, 40.85], 6.4],
  },
};
export const CHAR_KEYS = Object.keys(BOT_CHARS) as CharKey[];
// 官网给每个角色配的示例人设（文案在 i18n 的 bots.personas）。只是示例，不是角色的职责：产品里机器人的名字、人设、模型都是用户自己定的。
export const CHAR_PERSONA = { blue: "pair", yellow: "editor", green: "secretary", red: "german", purple: "home", orange: "expenses" } as const satisfies Record<CharKey, string>;
export type PersonaKey = (typeof CHAR_PERSONA)[CharKey];
export const BOT_CHARS_HASH = "8d055ed19deb2468";
