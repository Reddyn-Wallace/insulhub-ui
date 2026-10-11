import { afterEach, expect, it, vi } from 'vitest';
import { deliverCommunication } from './communication-delivery';
const input = { channel: 'sms' as const, provider: 'smsgate' as const, strictSmsgateConnection: true,
  messageId: 'campaign-recipient', smsValidUntil: '2026-10-09T04:30:00Z', from: '', to: '+64211234567', subject: '', body: 'Hello',
  providerConfig: { smsgateBaseUrl: 'https://sms.example.test', smsgateUsername: 'user', smsgatePassword: 'password', smsgateDeviceId: 'device' } };
afterEach(() => vi.unstubAllGlobals());
it('keeps successful queue acceptance distinct from confirmed sending and includes expiry and reference', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id: input.messageId, state: 'Pending' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await deliverCommunication(input)).toMatchObject({ ok: true, smsState: 'accepted', providerMessageId: input.messageId });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ id: input.messageId, validUntil: input.smsValidUntil, deviceId: 'device' });
});
it('recognises explicit queue rejection as safe to defer', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'QueueLimitExceeded', message: 'queue limits exceeded: too old pending message' }, { status: 503 })));
  expect(await deliverCommunication(input)).toMatchObject({ ok: false, retryable: true, failureReason: "queue limits exceeded: too old pending message" });
});
it.each([502, 408, 409])('preserves uncertainty for HTTP %s to avoid duplicate submissions', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream unavailable', { status })));
  expect(await deliverCommunication(input)).toMatchObject({ ok: false, uncertain: true });
});
it('preserves uncertainty after a network timeout', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
  await expect(deliverCommunication(input)).resolves.toMatchObject({ ok: false, uncertain: true });
});
it('does not treat mismatched message references as confirmed sending', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'wrong', state: 'Sent' })));
  expect(await deliverCommunication(input)).toMatchObject({ uncertain: true });
});
