import webpush, { type PushSubscription } from "web-push";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store";

export function validateSubscription(input: unknown): PushSubscription {
  if (!input || typeof input !== "object") throw new Error("Invalid push subscription");
  const s = input as Partial<PushSubscription>;
  if (typeof s.endpoint !== "string" || s.endpoint.length > 4096 || !s.keys || typeof s.keys.auth !== "string" || typeof s.keys.p256dh !== "string" ) throw new Error("Invalid push subscription");
  const url = new URL(s.endpoint);
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port || url.username || url.password || !(host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com") || host === "web.push.apple.com" || host.endsWith(".push.apple.com"))) throw new Error("Untrusted push endpoint");
  if (!/^[\w-]{20,32}$/.test(s.keys.auth) || !/^[\w-]{80,100}$/.test(s.keys.p256dh)) throw new Error("Invalid push keys");
  return s as PushSubscription;
}
export class Push {
  readonly publicKey: string;
  private pending = 0;
  constructor(readonly store: Store, dataDir: string) {
    const path = join(dataDir, "vapid.json");
    let keys: { publicKey: string; privateKey: string };
    try { keys = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      keys = webpush.generateVAPIDKeys();
      writeFileSync(path, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(Bun.env.VAPID_SUBJECT ?? "mailto:operator@example.com", keys.publicKey, keys.privateKey);
  }
  async send(title: string, body: string) {
    if (this.pending >= 8) throw new Error("Push delivery queue is full");
    this.pending++;
    try {
      const failures: string[] = [];
      for (const subscription of await this.store.subscriptions()) {
        try { await webpush.sendNotification(subscription, JSON.stringify({ title, body }), { TTL: 60, urgency: "high", timeout: 5000 }); }
        catch (error) {
          const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : 0;
          if (status === 404 || status === 410) await this.store.unsubscribe(subscription.endpoint);
          else failures.push(`Push provider returned ${String(status)}`);
        }
      }
      if (failures.length) throw new Error(failures.join("; "));
    } finally { this.pending--; }
  }
}
