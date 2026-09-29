import { expect, test } from 'bun:test';
import { DecisionService } from '../src/host/decision-api';
import { decisionLimits, decisionPresets, readDecisionAnswer, readDecisionRequest, type DecisionRequest } from '../src/core/decision';

const input: DecisionRequest = { state: { request: 'Show pump' }, questions: { next: { type: 'choice', instructions: 'Choose an action', criteria: { c0: 'Open source', none: 'Ask the human' } } } };
const good = () => ({ model: 'test-model', answers: { next: { type: 'choice', choice: 'c0', confidence: 0.9, probabilities: { c0: 0.95, none: 0.05 } } }, usage: { input_tokens: 10, output_tokens: 0 } });
const env = { SATURN_DECISION_PROVIDER: 'kev' };

test('System One request and answer validation fail closed on unknown or malformed options', () => {
  expect(readDecisionRequest(input)).toEqual(input);
  expect(readDecisionAnswer(good(), ['c0', 'none']).answers.next.choice).toBe('c0');
  for (const value of [null, {}, { ...input, questions: {} }, { ...input, state: null }, { ...input, state: 'x'.repeat(decisionLimits.requestBytes) },
    { ...input, questions: { next: { ...input.questions.next, criteria: { c0: 'only' } } } }]) expect(() => readDecisionRequest(value)).toThrow();
  for (const answer of [
    { ...good().answers.next, choice: 'execute-anything' },
    { ...good().answers.next, confidence: NaN },
    { ...good().answers.next, probabilities: { c0: 0.2, none: 0.8 } },
    { ...good().answers.next, probabilities: { c0: 0.2, none: 0.1 } },
    { ...good().answers.next, probabilities: { c0: 1 } },
    { ...good().answers.next, probabilities: { c0: 0.9, none: 0, extra: 0.1 } },
    { ...good().answers.next, probabilities: { c0: Infinity, none: 0 } },
  ]) expect(() => readDecisionAnswer({ ...good(), answers: { next: answer } }, ['c0', 'none'])).toThrow();
  expect(() => readDecisionAnswer({ ...good(), usage: { input_tokens: -1, output_tokens: 0 } }, ['c0', 'none'])).toThrow();
});

test('local, TypeSafe and Vercel presets use the same System One wire shape and host-owned credentials', async () => {
  for (const provider of ['kev', 'typesafe', 'vercel'] as const) {
    let called = 0;
    const service = new DecisionService({ SATURN_DECISION_PROVIDER: provider, SATURN_DECISION_API_KEY: 'host-secret' }, async (url, init) => {
      called++;
      expect(url).toBe(decisionPresets[provider].endpoint);
      expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer host-secret');
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ ...input, model: decisionPresets[provider].model });
      return Response.json(good());
    });
    try {
      expect(service.status().enabled).toBe(true);
      expect(JSON.stringify(service.status())).not.toContain('host-secret');
      await service.evaluate({ ...input, model: 'browser-model', endpoint: 'https://attacker.invalid', key: 'browser-secret' }, new AbortController().signal);
      expect(called).toBe(1);
    } finally { service.close(); }
  }
});

test('custom compatible endpoint/model override is explicit; remote HTTP, URL secrets and chat endpoints are rejected', async () => {
  const custom = new DecisionService({ SATURN_DECISION_PROVIDER: 'custom', SATURN_DECISION_URL: 'https://model.example/v1/systemone', SATURN_DECISION_MODEL: 'my-kev' }, async (url, init) => {
    expect(url).toBe('https://model.example/v1/systemone'); expect(JSON.parse(String(init.body)).model).toBe('my-kev'); return Response.json(good());
  });
  try { await custom.evaluate(input, new AbortController().signal); } finally { custom.close(); }
  for (const bad of [
    { SATURN_DECISION_PROVIDER: 'unknown' },
    { SATURN_DECISION_PROVIDER: 'typesafe' },
    { ...env, SATURN_DECISION_URL: 'http://remote.example/v1/systemone' },
    { ...env, SATURN_DECISION_URL: 'https://user:key@model.example/v1/systemone' },
    { ...env, SATURN_DECISION_URL: 'https://model.example/v1/systemone?key=secret' },
    { ...env, SATURN_DECISION_URL: 'http://127.0.0.1:8009/v1/chat/completions' },
    { ...env, SATURN_DECISION_TIMEOUT_MS: '0' },
  ]) {
    const service = new DecisionService(bad);
    expect(service.status().enabled).toBe(false); expect(service.status().error).not.toBe(''); service.close();
  }
  const disabled = new DecisionService({}); expect(disabled.status().enabled).toBe(false); expect(disabled.status().error).toBe(''); disabled.close();
});

test('provider errors are sanitized and never retried or switched to another server', async () => {
  for (const status of [401, 429, 529]) {
    let calls = 0;
    const service = new DecisionService(env, async () => { calls++; return new Response('provider-secret and internal trace', { status }); });
    try {
      let error = ''; try { await service.evaluate(input, new AbortController().signal); } catch (reason) { error = String(reason); }
      expect(error).not.toBe(''); expect(error).not.toContain('provider-secret'); expect(calls).toBe(1);
    } finally { service.close(); }
  }
  const huge = new DecisionService(env, async () => new Response('x'.repeat(decisionLimits.responseBytes + 1)));
  try { await expect(huge.evaluate(input, new AbortController().signal)).rejects.toThrow('too large'); } finally { huge.close(); }
  const invalid = new DecisionService(env, async () => Response.json({ model: 'fake', answers: { next: { ...good().answers.next, choice: 'rm -rf' } } }));
  try { await expect(invalid.evaluate(input, new AbortController().signal)).rejects.toThrow('invalid choice'); } finally { invalid.close(); }
});

test('timeout, user cancellation, concurrency bounds and shutdown release the transport', async () => {
  let sends = 0;
  const service = new DecisionService({ ...env, SATURN_DECISION_TIMEOUT_MS: '500' }, async (_url, init) => {
    sends++;
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!;
      if (signal.aborted) reject(new Error('cancelled'));
      else signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
  });
  const first = new AbortController(), second = new AbortController();
  try {
    const a = service.evaluate(input, first.signal).catch(error => String(error));
    const b = service.evaluate(input, second.signal).catch(error => String(error));
    await expect(service.evaluate(input, new AbortController().signal)).rejects.toThrow('already in progress');
    first.abort(); second.abort();
    expect(await a).toContain('cancelled'); expect(await b).toContain('cancelled');
    await expect(service.evaluate(input, new AbortController().signal)).rejects.toThrow('timed out');
    const closing = service.evaluate(input, new AbortController().signal).catch(error => String(error)); service.close();
    expect(await closing).toContain('cancelled'); expect(sends).toBe(4);
    await expect(service.evaluate(input, new AbortController().signal)).rejects.toThrow('closing');
  } finally { service.close(); }
});
