import { expect, it } from 'vitest';
import { campaignSmsValidUntil } from './campaign-sms-queue';
import { DEFAULT_COMMUNICATION_SETTINGS } from './communication-settings';
it('expires at the NZ send-window boundary instead of sending late after a phone wakes', () => {
  expect(campaignSmsValidUntil(DEFAULT_COMMUNICATION_SETTINGS, new Date('2026-10-09T04:29:30Z'))).toBe('2026-10-09T04:30:00.000Z');
});
it('caps a stalled message at one hour even with sending hours disabled', () => {
  expect(campaignSmsValidUntil({...DEFAULT_COMMUNICATION_SETTINGS, campaignSendWindowEnabled:false},new Date('2026-10-09T00:00:00Z'))).toBe('2026-10-09T01:00:00.000Z');
});
