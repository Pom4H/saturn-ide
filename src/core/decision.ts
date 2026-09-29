/** TypeSafe System One wire contract used by the optional Shell decision adapter.
 * Decisions select existing options. They never carry executable code or authority. */
export interface DecisionQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}
export interface DecisionRequest {
  readonly state: unknown;
  readonly questions: { readonly next: DecisionQuestion };
}
export interface DecisionAnswer {
  readonly model: string;
  readonly answers: { readonly next: {
    readonly type: 'choice'; readonly choice: string; readonly confidence: number;
    readonly probabilities: Readonly<Record<string, number>>;
  } };
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
}
export interface DecisionStatus {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly error: string;
}
export const decisionPresets = {
  kev: { endpoint: 'http://127.0.0.1:8009/v1/systemone', model: 'kev-latest' },
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
  vercel: { endpoint: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone', model: 'jev-latest' },
} as const;
export const decisionLimits = { choices: 101, requestBytes: 131072, responseBytes: 65536, prompt: 2000 } as const;
export const decisionRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

export function readDecisionRequest(value: unknown): DecisionRequest {
  if (!decisionRecord(value) || !decisionRecord(value.questions) || Object.keys(value.questions).length !== 1 || !decisionRecord(value.questions.next)) throw new Error('Expected one named decision question');
  const question = value.questions.next;
  if (question.type !== 'choice' || typeof question.instructions !== 'string' || !question.instructions.trim() || question.instructions.length > 4096 || !decisionRecord(question.criteria)) throw new Error('Invalid choice question');
  const entries = Object.entries(question.criteria);
  if (entries.length < 2 || entries.length > decisionLimits.choices || entries.some(([id, label]) => !/^(?:c\d+|none)$/.test(id) || typeof label !== 'string' || label.length > 2000)) throw new Error('Invalid decision options');
  if (typeof value.state !== 'string' && !Array.isArray(value.state) && !decisionRecord(value.state)) throw new Error('Invalid decision state');
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > decisionLimits.requestBytes) throw new Error('Decision context is too large; narrow the selection');
  return { state: value.state, questions: { next: { type: 'choice', instructions: question.instructions, criteria: Object.fromEntries(entries) as Record<string, string> } } };
}

/** Validate even a typed provider: an arbitrary compatible server is an untrusted boundary. */
export function readDecisionAnswer(value: unknown, options: readonly string[]): DecisionAnswer {
  const fail = (): never => { throw new Error('Invalid decision response; no action selected'); };
  if (!decisionRecord(value) || typeof value.model !== 'string' || !value.model || value.model.length > 256 || !decisionRecord(value.answers) || Object.keys(value.answers).length !== 1 || !decisionRecord(value.answers.next)) return fail();
  const answer = value.answers.next;
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !options.includes(answer.choice) || !probability(answer.confidence) || !decisionRecord(answer.probabilities)) return fail();
  const entries = Object.entries(answer.probabilities);
  if (entries.length !== options.length || entries.some(([id, p]) => !options.includes(id) || !probability(p))) return fail();
  const probabilities = Object.fromEntries(entries) as Record<string, number>;
  if (Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.001 || probabilities[answer.choice]! + 1e-6 < Math.max(...Object.values(probabilities))) return fail();
  const usage = value.usage;
  if (usage !== undefined && (!decisionRecord(usage) || !Number.isSafeInteger(usage.input_tokens) || Number(usage.input_tokens) < 0 || !Number.isSafeInteger(usage.output_tokens) || Number(usage.output_tokens) < 0)) return fail();
  return {
    model: value.model,
    answers: { next: { type: 'choice', choice: answer.choice, confidence: answer.confidence, probabilities } },
    ...(decisionRecord(usage) ? { usage: { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) } } : {}),
  };
}
