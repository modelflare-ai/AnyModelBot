/*
 * 微信 iLink 扫码登录状态机（供 UI 与 CLI 共用）。
 * 流程移植自 Tencent/openclaw-weixin src/auth/login-qr.ts（MIT，见 ./LICENSE.openclaw-weixin）。
 */
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { IlinkClient, type QrStatusResp } from "./api.js";
import { logger } from "../../log.js";
import { t } from "../../i18n/index.js";

const log = logger("weixin.login");
const MAX_QR_REFRESH = 3;
const LOGIN_TIMEOUT_MS = 8 * 60_000;

export type LoginState =
  | "idle"
  | "fetching"
  | "wait"
  | "scaned"
  | "need_verifycode"
  | "confirmed"
  | "already_bound"
  | "failed"
  | "cancelled";

export interface LoginSnapshot {
  state: LoginState;
  message: string;
  /** 二维码内容（URL）；UI 用 dataUrl 显示 */
  qrContent?: string;
  qrDataUrl?: string;
  qrPngPath?: string;
  refreshCount: number;
}

export interface LoginResult {
  botToken: string;
  ilinkBotId: string;
  baseUrl: string;
  userId: string;
}

export class WeixinLogin {
  snapshot: LoginSnapshot = { state: "idle", message: "", refreshCount: 0 };
  private abort = new AbortController();
  private verifyCode: string | undefined;
  private onUpdate: ((s: LoginSnapshot) => void) | undefined;

  constructor(
    private opts: {
      apiBaseUrl: string;
      pngPath?: string;
      fetchImpl?: typeof fetch;
      printTerminal?: boolean;
      localTokens?: string[];
      pollDelayMs?: number;
    },
  ) {}

  subscribe(fn: (s: LoginSnapshot) => void): void {
    this.onUpdate = fn;
  }

  private set(patch: Partial<LoginSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onUpdate?.(this.snapshot);
  }

  submitVerifyCode(code: string): void {
    this.verifyCode = code.trim();
  }

  cancel(): void {
    this.abort.abort();
    if (!["confirmed", "failed", "already_bound"].includes(this.snapshot.state)) this.set({ state: "cancelled", message: t("channel.login_cancelled") });
  }

  private async showQr(client: IlinkClient): Promise<string> {
    const qr = await client.getBotQrCode(this.opts.localTokens ?? []);
    const content = qr.qrcode_img_content;
    const qrDataUrl = await QRCode.toDataURL(content, { margin: 1, width: 320 });
    if (this.opts.pngPath) {
      fs.mkdirSync(path.dirname(this.opts.pngPath), { recursive: true });
      await QRCode.toFile(this.opts.pngPath, content, { margin: 1, width: 320 });
    }
    if (this.opts.printTerminal) {
      const qt = (await import("qrcode-terminal")).default;
      qt.generate(content, { small: true }, (s: string) => process.stdout.write(`\n${t("channel.login_terminal_scan")}\n${s}\n`));
      if (this.opts.pngPath) process.stdout.write(`${t("channel.login_terminal_saved", { path: this.opts.pngPath })}\n`);
    }
    this.set({ state: "wait", message: t("channel.login_wait"), qrContent: content, qrDataUrl, qrPngPath: this.opts.pngPath });
    return qr.qrcode;
  }

  /** 运行完整登录流程，成功返回凭据，失败/取消返回 undefined。 */
  async run(): Promise<LoginResult | undefined> {
    const signal = this.abort.signal;
    let client = new IlinkClient({ baseUrl: this.opts.apiBaseUrl, fetchImpl: this.opts.fetchImpl });
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let refreshCount = 0;
    try {
      this.set({ state: "fetching", message: t("channel.login_fetching"), refreshCount });
      let qrcode = await this.showQr(client);
      while (!signal.aborted && Date.now() < deadline) {
        let st: QrStatusResp;
        const code = this.verifyCode;
        st = await client.getQrCodeStatus(qrcode, code, 35_000, signal);
        if (code && this.verifyCode === code) this.verifyCode = undefined;
        switch (st.status) {
          case "wait":
            break;
          case "scaned":
            if (this.snapshot.state !== "scaned") this.set({ state: "scaned", message: t("channel.login_scanned") });
            break;
          case "need_verifycode":
            if (this.snapshot.state !== "need_verifycode") this.set({ state: "need_verifycode", message: t("channel.login_need_code") });
            break;
          case "scaned_but_redirect":
            if (st.redirect_host) {
              client = new IlinkClient({ baseUrl: `https://${st.redirect_host}`, fetchImpl: this.opts.fetchImpl });
              log.info("IDC redirect", { host: st.redirect_host });
            }
            break;
          case "binded_redirect":
            this.set({ state: "already_bound", message: t("channel.login_already_bound") });
            return undefined;
          case "expired":
          case "verify_code_blocked":
            refreshCount++;
            if (refreshCount > MAX_QR_REFRESH) {
              this.set({ state: "failed", message: t("channel.login_qr_expired_too_often") });
              return undefined;
            }
            this.set({ refreshCount, message: t("channel.login_qr_refreshing", { n: refreshCount, max: MAX_QR_REFRESH }) });
            qrcode = await this.showQr(client);
            break;
          case "confirmed": {
            if (!st.ilink_bot_id || !st.bot_token) {
              this.set({ state: "failed", message: t("channel.login_no_token") });
              return undefined;
            }
            this.set({ state: "confirmed", message: t("channel.login_confirmed"), qrDataUrl: undefined, qrContent: undefined });
            log.info("weixin login confirmed", { ilinkBotId: st.ilink_bot_id });
            return {
              botToken: st.bot_token,
              ilinkBotId: st.ilink_bot_id,
              baseUrl: st.baseurl || this.opts.apiBaseUrl,
              userId: st.ilink_user_id || "",
            };
          }
        }
        await new Promise((r) => setTimeout(r, this.opts.pollDelayMs ?? 1000));
      }
      if (!signal.aborted) this.set({ state: "failed", message: t("channel.login_timeout") });
      return undefined;
    } catch (e) {
      if (signal.aborted) return undefined;
      this.set({ state: "failed", message: t("channel.login_failed", { message: (e as Error).message }) });
      return undefined;
    }
  }
}
