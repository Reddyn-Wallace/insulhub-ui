import { describe, expect, it } from 'vitest';
import { canResumeCampaignRecipient } from './campaign-resume';

describe('halted campaign recipients', () => {
  const halted = { status: 'skipped', failureReason: 'Campaign halted before delivery.', selected: true };
  it('restores only unsent recipients skipped by halting', () => {
    expect(canResumeCampaignRecipient(halted)).toBe(true);
    for (const change of [
      { status: 'sent' }, { status: 'failed' }, { status: 'pending' },
      { selected: false }, { failureReason: 'Invalid destination' },
      { sentAt: '2026-10-05T00:00:00Z' }, { providerMessageId: 'delivered-id' },
    ]) expect(canResumeCampaignRecipient({ ...halted, ...change })).toBe(false);
  });
  it('allows recipients halted because their sending connection became unavailable', () => {
    expect(canResumeCampaignRecipient({ ...halted, failureReason: 'Sending connection is unavailable or its owner has not authorised this campaign. Create a new campaign using your own connected account.' })).toBe(true);
  });
});
