import {expect,it} from 'vitest';
import {buildContactTemplateFields,applyTemplateFields} from '../contact-template-fields';
it('renders the normal fields from the quote and supports both old and normal token syntax',()=>{
 const fields=buildContactTemplateFields({jobNumber:12,client:{contactDetails:{name:'JANE SMITH',streetAddress:'1 Test Street',city:'Wellington',phoneMobile:'0212345678',email:'jane@example.test'}},lead:{quoteBookingDate:'2026-10-01T21:00:00Z',allocatedTo:{firstname:'Alex',lastname:'Jones'}},quote:{quoteNumber:'Q123'},installation:{installDate:'2026-10-03T20:00:00Z'}},'Fallback Person',50000);
 expect(applyTemplateFields('{customer name}|{first name}|{salesperson}|{salesperson first name}|{address}|{job number}|{quote number}|{phone}|{email}|{discount}',fields)).toBe('Jane Smith|Jane|Alex|Alex|1 Test Street, Wellington|12|Q123|0212345678|jane@example.test|$500.00');
 expect(applyTemplateFields('{{name}} {{quoteNumber}} {{discount}}',fields)).toBe('Jane Smith Q123 $500.00');
 for(const field of ['quotebookingdate','installdate','installtime'])expect(fields[field]).not.toBe('');
});
it('keeps a normal follow-up unchanged when it has no discount field',()=>{
 const fields=buildContactTemplateFields({client:{contactDetails:{name:'Alex'}}},'Reddyn',null);
 expect(applyTemplateFields('Hi {first name}, any questions?',fields)).toBe('Hi Alex, any questions?');
 expect(fields.discount).toBe('');
});
