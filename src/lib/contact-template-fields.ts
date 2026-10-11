import { firstNameForMerge, formatNameForMerge } from './communication-merge-fields';

export type ContactTemplate = {
  id: string; title: string; channel: 'sms' | 'email' | 'calendar';
  description: string; subject: string; body: string; sortOrder: number;
};
export const CONTACT_TEMPLATE_FIELDS = ['customer name', 'first name', 'salesperson', 'salesperson first name', 'address', 'quote booking date', 'install date', 'install time', 'job number', 'quote number', 'phone', 'email', 'discount'];

type TemplateJob = {
  jobNumber?: string | number | null;
  client?: { contactDetails?: { name?: string | null; streetAddress?: string | null; suburb?: string | null; city?: string | null; postCode?: string | null; phoneMobile?: string | null; phoneSecondary?: string | null; email?: string | null } | null } | null;
  lead?: { quoteBookingDate?: string | null; allocatedTo?: { firstname?: string | null; lastname?: string | null } | null } | null;
  quote?: { quoteNumber?: string | number | null } | null;
  installation?: { installDate?: string | null } | null;
};

export function applyTemplateFields(template: string, fields: Record<string, string>) {
  return template.replace(/\{\{([^{}]+)\}\}|\{([^{}]+)\}/g, (_match, legacy, key) => fields[String(legacy || key).toLowerCase().replace(/[^a-z0-9]/g, '')] ?? '');
}

function dateField(value: string | null | undefined, kind: 'date' | 'time' | 'datetime') {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    ...(kind !== 'time' ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } as const : {}),
    ...(kind !== 'date' ? { hour: 'numeric', minute: '2-digit' } as const : {}),
  });
}

export function buildContactTemplateFields(job: TemplateJob, fallbackSalesperson = '', discountCents?: number | null): Record<string, string> {
  const contact = job.client?.contactDetails;
  const name = formatNameForMerge(contact?.name || '') || 'there';
  const salesperson = job.lead?.allocatedTo?.firstname?.trim() || firstNameForMerge(fallbackSalesperson) || 'Insulmax';
  return {
    customername: name, name, firstname: firstNameForMerge(name),
    salesperson, salespersonfirstname: salesperson, salespersonname: salesperson,
    salesrep: salesperson, salesrepname: salesperson, salesrepfirstname: salesperson,
    salesconsultant: salesperson, salesconsultantname: salesperson, salesconsultantfirstname: salesperson,
    address: [contact?.streetAddress, contact?.suburb, contact?.city, contact?.postCode].filter(Boolean).join(', ') || 'your property',
    quotebookingdate: dateField(job.lead?.quoteBookingDate, 'datetime') || 'the booked time',
    installdate: dateField(job.installation?.installDate, 'date') || 'the install date',
    installtime: dateField(job.installation?.installDate, 'time') || '8:00 AM',
    jobnumber: String(job.jobNumber ?? ''), quotenumber: String(job.quote?.quoteNumber ?? job.jobNumber ?? ''),
    phone: contact?.phoneMobile || contact?.phoneSecondary || '', email: contact?.email || '',
    discount: discountCents != null && discountCents > 0 ? '$' + (discountCents / 100).toFixed(2) : '',
  };
}
