/**
 * 账户凭据的本机存放：<数据目录>/modelflare-account.json（权限 600，经临时文件改名写入）。
 * 和数据目录里的其他凭据（内置网关的 API Key、渠道令牌）一样只靠文件权限保护：桌面版、命令行、
 * Docker 读写同一种格式，数据目录拷到别处也能用，macOS 上也不会弹钥匙串权限窗。
 * refresh token 不出这个文件，界面只拿到账户名称。
 *
 * 0.1.30 及以前的桌面版用系统钥匙串加密（enc: "safe-storage"）：桌面版读到这种旧文件时解密一次、
 * 改写成明文，以后不再碰钥匙串；解不开（拒绝了钥匙串授权、密钥已删）就当作没登录，重新登录时覆盖。
 */
import type { AccountProfile } from "./profile.js";
import fs from "node:fs";
import path from "node:path";
import { t } from "../i18n/index.js";
import { logger } from "../log.js";

const log = logger("account");

/** 桌面外壳提供的旧文件解密（Electron safeStorage），只用来迁移 0.1.30 及以前加密的账户文件 */
export interface LegacySecretBox {
  decrypt(data: Buffer): string;
}

export interface AccountRecord {
  issuer: string;
  refreshToken: string;
  scope: string;
  /** 登录时为本机签发的 API Key（服务端 id；明文只在内置网关配置里） */
  deviceKeyId: number;
  signedInAt: number;
  /** Stable local progress namespace; never used as a display name. */
  ownerKey?: string;
  profile?: AccountProfile;
  /** ID Token 的 sub：打开充值页时让网页核对是不是同一个账户（不是密钥，见 oauth.ts 的 TokenSet.subject） */
  subject?: string;
}

interface FileShape {
  v: 1;
  /** "safe-storage" 只出现在旧桌面版写的文件里 */
  enc: "safe-storage" | "none";
  data: string;
}

export class AccountVault {
  constructor(readonly file: string, private legacy?: LegacySecretBox) {}

  static at(dataDir: string, legacy?: LegacySecretBox): AccountVault {
    return new AccountVault(path.join(dataDir, "modelflare-account.json"), legacy);
  }

  /** undefined = 没有登录；抛错 = 文件在但读不出来（例如命令行版读到旧桌面版加密的文件） */
  load(): AccountRecord | undefined {
    if (!fs.existsSync(this.file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as FileShape;
    if (raw.v !== 1) throw new Error(t("account.vault_bad_version"));
    if (raw.enc === "safe-storage") return this.migrate(raw.data);
    return parseRecord(Buffer.from(raw.data, "base64").toString("utf8"));
  }

  /** 旧桌面版加密的文件：解密一次并改写成明文 */
  private migrate(data: string): AccountRecord | undefined {
    if (!this.legacy) throw new Error(t("account.vault_encrypted"));
    let rec: AccountRecord;
    try {
      rec = parseRecord(this.legacy.decrypt(Buffer.from(data, "base64")));
    } catch (e) {
      // 文件留着：下次启动还会再试；重新登录时被新凭据覆盖
      log.warn(`旧账户文件解不开，按未登录处理：${(e as Error).message}`);
      return undefined;
    }
    try {
      this.save(rec);
      log.info("账户文件已从系统钥匙串加密改为文件权限保护");
    } catch (e) {
      log.warn(`账户文件改写失败，下次启动再试：${(e as Error).message}`);
    }
    return rec;
  }

  save(rec: AccountRecord): void {
    const shape: FileShape = { v: 1, enc: "none", data: Buffer.from(JSON.stringify(rec), "utf8").toString("base64") };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(shape) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}

function parseRecord(json: string): AccountRecord {
  const rec = JSON.parse(json) as AccountRecord;
  if (!rec.refreshToken || !rec.issuer) throw new Error(t("account.vault_incomplete"));
  return rec;
}
