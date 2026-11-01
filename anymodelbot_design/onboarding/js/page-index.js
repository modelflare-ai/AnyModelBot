// 目录页：标题旁的天天一进来就弹出来打招呼，之后会动、能戳
import * as P from "./proto.js";

P.init();
const host = P.$("header .bot-face");
if (host) P.playShot(host, "hello");
