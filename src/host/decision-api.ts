import { decisionLimits, decisionPresets, readDecisionAnswer, readDecisionRequest, type DecisionAnswer, type DecisionStatus } from '../core/decision';
import { HttpError } from '../workspace/files';

type Environment = Readonly<Record<string, string | undefined>>;
type DecisionFetch = (url: string, init: RequestInit) => Promise<Response>;
interface Configuration { endpoint: string; model: string; key: string; timeoutMs: number }

function configuration(env: Environment): Configuration | null {
  const provider = env.SATURN_DECISION_PROVIDER;
  if (!provider && !env.SATURN_DECISION_URL) return null;
  if (provider && !['kev', 'typesafe', 'vercel', 'custom'].includes(provider)) throw new Error('SATURN_DECISION_PROVIDER: kev, typesafe, vercel or custom');
  const preset = provider && provider !== 'custom' ? decisionPresets[provider as keyof typeof decisionPresets] : undefined;
  let url: URL;
  try { url = new URL(env.SATURN_DECISION_URL ?? preset?.endpoint ?? ''); }
  catch { throw new Error('Set SATURN_DECISION_URL to the complete System One endpoint'); }
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\./.test(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !local || url.username || url.password || url.search || url.hash) throw new Error('Use HTTPS for remote decisions; HTTP is allowed only on loopback. No URL credentials, query or fragment.');
  if (!url.pathname.endsWith('/v1/systemone')) throw new Error('Expected a complete /v1/systemone endpoint, not chat/completions or /v1/evaluate');
  const model = env.SATURN_DECISION_MODEL ?? preset?.model;
  if (!model || model.length > 256 || /[\r\n]/.test(model)) throw new Error('Set SATURN_DECISION_MODEL');
  const key = env.SATURN_DECISION_API_KEY ?? (provider === 'vercel' ? env.AI_GATEWAY_API_KEY : provider === 'typesafe' ? env.TYPESAFE_API_KEY : '') ?? '';
  if (/[\r\n]/.test(key) || key.length > 8192) throw new Error('Invalid decision API key');
  if ((provider === 'vercel' || provider === 'typesafe') && !key) throw new Error('Set SATURN_DECISION_API_KEY (or the provider API key) on the Saturn host');
  const timeoutMs = Number(env.SATURN_DECISION_TIMEOUT_MS ?? 30000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 120000) throw new Error('SATURN_DECISION_TIMEOUT_MS must be 500…120000');
  return { endpoint: url.href, model, key, timeoutMs };
}

async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > decisionLimits.responseBytes) { await response.body?.cancel(); throw new HttpError(502, 'Decision response is too large'); }
  if (!response.body) throw new HttpError(502, 'Empty decision response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > decisionLimits.responseBytes) throw new HttpError(502, 'Decision response is too large');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpError(502, 'Decision server returned invalid JSON'); }
}

/** Optional, host-owned transport. No source execution, runtime calls, browser keys or automatic fallback. */
export class DecisionService {
  private config: Configuration | null = null;
  private error = '';
  private active = 0;
  private readonly shutdown = new AbortController();
  constructor(env: Environment = process.env, private readonly send: DecisionFetch = (url, init) => fetch(url, init)) {
    // A broken optional provider must not prevent the IDE/runtime from starting.
    try { this.config = configuration(env); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Invalid decision configuration'; }
  }
  status(): DecisionStatus {
    return { enabled: !!this.config, endpoint: this.config?.endpoint ?? '', model: this.config?.model ?? '', timeoutMs: this.config?.timeoutMs ?? 30000, error: this.error };
  }
  close(): void { this.shutdown.abort(); }
  async evaluate(value: unknown, cancelled: AbortSignal): Promise<DecisionAnswer> {
    const config = this.config;
    if (!config) throw new HttpError(503, this.error || 'Decision model is not configured. Set SATURN_DECISION_PROVIDER on the Saturn host.');
    if (this.shutdown.signal.aborted) throw new HttpError(503, 'Decision service is closing');
    if (this.active >= 2) throw new HttpError(429, 'A decision is already in progress; cancel it or try again explicitly');
    let input;
    try { input = readDecisionRequest(value); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid decision request'); }
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), config.timeoutMs);
    const signal = AbortSignal.any([cancelled, timeout.signal, this.shutdown.signal]);
    this.active++;
    try {
      signal.throwIfAborted();
      const response = await this.send(config.endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(config.key ? { authorization: `Bearer ${config.key}` } : {}) },
        body: JSON.stringify({ ...input, model: config.model }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Never relay provider bodies, credentials, traces or automatic retry instructions.
        const message = response.status === 401 || response.status === 403 ? 'Decision API authentication failed; check the host API key'
          : response.status === 429 ? 'Decision API rate limit; retry explicitly later'
          : `Decision API returned HTTP ${response.status}; no command was executed`;
        throw new HttpError(502, message);
      }
      const raw = await boundedJson(response);
      signal.throwIfAborted();
      try { return readDecisionAnswer(raw, Object.keys(input.questions.next.criteria)); }
      catch { throw new HttpError(502, 'Decision API returned an invalid choice or probability distribution'); }
    } catch (error) {
      if (timeout.signal.aborted) throw new HttpError(504, 'Decision timed out; no command was executed. Adjust SATURN_DECISION_TIMEOUT_MS for a slower local model.');
      if (cancelled.aborted || this.shutdown.signal.aborted) throw new HttpError(499, 'Decision cancelled; no command was executed');
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Cannot reach the configured decision API; no command was executed');
    } finally { clearTimeout(timer); this.active--; }
  }
}
