/**
 * 账户凭据的本机存放：<数据目录>/modelflare-account.json（权限 600，经临时文件改名写入）。
 * 桌面版用系统钥匙串加密（Electron safeStorage）；命令行 / Docker 没有钥匙串，与内置网关保存
 * API Key 的方式一致，只靠文件权限保护。refresh token 不出这个文件，界面只拿到账户名称。
 */
import fs from "node:fs";
import path from "node:path";

/** 由桌面外壳提供的加解密（系统钥匙串） */
export interface SecretBox {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export interface AccountRecord {
  issuer: string;
  refreshToken: string;
  scope: string;
  /** 登录时为本机签发的 API Key（服务端 id；明文只在内置网关配置里） */
  deviceKeyId: number;
  signedInAt: number;
}

interface FileShape {
  v: 1;
  enc: "safe-storage" | "none";
  data: string;
}

export class AccountVault {
  constructor(readonly file: string, private box?: SecretBox) {}

  static at(dataDir: string, box?: SecretBox): AccountVault {
    return new AccountVault(path.join(dataDir, "modelflare-account.json"), box);
  }

  /** undefined = 没有登录；抛错 = 文件在但读不出来（例如换到了没有钥匙串的命令行版） */
  load(): AccountRecord | undefined {
    if (!fs.existsSync(this.file)) return undefined;
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as FileShape;
    if (raw.v !== 1) throw new Error("不认识的账户文件版本");
    let json: string;
    if (raw.enc === "safe-storage") {
      if (!this.box) throw new Error("账户凭据由桌面版加密，当前运行方式无法读取");
      json = this.box.decrypt(Buffer.from(raw.data, "base64"));
    } else {
      json = Buffer.from(raw.data, "base64").toString("utf8");
    }
    const rec = JSON.parse(json) as AccountRecord;
    if (!rec.refreshToken || !rec.issuer) throw new Error("账户文件不完整");
    return rec;
  }

  save(rec: AccountRecord): void {
    const json = JSON.stringify(rec);
    const shape: FileShape = this.box
      ? { v: 1, enc: "safe-storage", data: this.box.encrypt(json).toString("base64") }
      : { v: 1, enc: "none", data: Buffer.from(json, "utf8").toString("base64") };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(shape) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  clear(): void {
    fs.rmSync(this.file, { force: true });
  }
}
