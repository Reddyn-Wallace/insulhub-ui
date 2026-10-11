import type { OfferTemplate } from './templates';

// Stable editor IDs keep existing defaults in their audited store, shared with sending.
export function followupTemplateKey(id?: string): Pick<OfferTemplate, 'channel' | 'approach'> | null {
  const match = id?.match(/^quote-followup-(sms|email)-([12])$/);
  return match ? { channel: match[1] as OfferTemplate['channel'], approach: Number(match[2]) as 1 | 2 } : null;
}

export function followupTemplateItem(template: OfferTemplate) {
  return {
    id: `quote-followup-${template.channel}-${template.approach}`,
    title: `Quote follow-up — ${template.approach === 1 ? 'first' : 'second'} offer`,
    channel: template.channel,
    description: 'Default message for quote follow-ups.',
    subject: template.subject,
    body: template.body,
    sortOrder: 100 + template.approach,
  };
}
