import { expect, test } from 'bun:test';
import { validateSubscription } from '../src/runtime/push';
test('push subscriptions cannot issue arbitrary outbound requests',()=>{
  const keys={auth:'a'.repeat(22),p256dh:'b'.repeat(87)};expect(validateSubscription({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys}).keys).toEqual(keys);
  for(const endpoint of ['http://localhost/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com:444/x'])expect(()=>validateSubscription({endpoint,keys})).toThrow();
});
