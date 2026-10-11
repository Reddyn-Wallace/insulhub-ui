import { expect, it } from 'vitest';
import { buildCampaignExclusionIndex, isExcludedFromCampaign } from './campaign-exclusions';
const exclusions = buildCampaignExclusionIndex([
  { jobId: 'same-job', destination: 'ALICE@EXAMPLE.COM ', channel: 'email' },
  { jobId: 'sms-job', destination: '+64 21 123 4567', channel: 'sms' },
]);
it('excludes the same job across channels and matching email contacts across jobs', () => {
  expect(isExcludedFromCampaign(exclusions, 'same-job', '+64210000000', 'sms')).toBe(true);
  expect(isExcludedFromCampaign(exclusions, 'another-job', ' alice@example.com ', 'email')).toBe(true);
  expect(isExcludedFromCampaign(exclusions, 'new-job', 'new@example.com', 'email')).toBe(false);
});
it('matches NZ mobile formats and never excludes unrelated blank contacts', () => {
  for (const phone of ['021 123 4567', '0064 21 123 4567', '+64211234567']) {
    expect(isExcludedFromCampaign(exclusions, 'different-job', phone, 'sms')).toBe(true);
  }
  expect(isExcludedFromCampaign(buildCampaignExclusionIndex([{ jobId: '', destination: '', channel: 'sms' }]), '', '', 'sms')).toBe(false);
});
