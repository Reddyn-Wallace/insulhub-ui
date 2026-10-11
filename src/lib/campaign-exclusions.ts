export type CampaignExclusionRecipient = {
  jobId: string;
  destination: string;
  channel: 'email' | 'sms';
};

function contactKey(destination: string, channel: 'email' | 'sms') {
  let value = destination.trim().toLowerCase();
  if (channel === 'sms') {
    value = value.replace(/[\s().-]/g, '');
    if (value.startsWith('00')) value = `+${value.slice(2)}`;
    else if (value.startsWith('0')) value = `+64${value.slice(1)}`;
    else if (value.startsWith('64')) value = `+${value}`;
  }
  return value ? `${channel}:${value}` : '';
}

export function buildCampaignExclusionIndex(recipients: CampaignExclusionRecipient[]) {
  return {
    jobIds: new Set(recipients.map(row => row.jobId.trim()).filter(Boolean)),
    contacts: new Set(recipients.map(row => contactKey(row.destination, row.channel)).filter(Boolean)),
  };
}

export function isExcludedFromCampaign(
  index: ReturnType<typeof buildCampaignExclusionIndex>,
  jobId: string,
  destination: string,
  channel: 'email' | 'sms',
) {
  return index.jobIds.has(jobId.trim()) || index.contacts.has(contactKey(destination, channel));
}

export function validExcludedCampaignIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(id =>
    typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
}
