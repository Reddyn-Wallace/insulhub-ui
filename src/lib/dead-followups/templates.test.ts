import {expect,it} from 'vitest';
import {defaultTemplates,validateTemplates,renderTemplate} from './templates';
it('has first and second templates for both channels with exact discount',()=>{const templates=defaultTemplates();expect(templates).toHaveLength(4);for(const t of templates)expect(renderTemplate(t,{discountCents:50000,name:'Alex',quoteNumber:'42'}).body).toContain('$500.00');});
it('rejects missing discount, unknown tokens, duplicate keys and oversized SMS',()=>{
 const defaults=defaultTemplates();
 for(const replacement of [{...defaults[0],body:'Hello'},{...defaults[0],body:'{{discount}} {{expiry}}'},{...defaults[0],body:'{{discount}}'+'x'.repeat(1601)}])expect(()=>validateTemplates([replacement,...defaults.slice(1)])).toThrow();
 expect(()=>validateTemplates([defaults[0],defaults[0],...defaults.slice(2)])).toThrow();
});
it('merges user data as literal text and leaves no unresolved merge fields',()=>{
 const t={...defaultTemplates()[0],body:'Hi {{name}}, quote {{quoteNumber}}: {{discount}}.'};
 expect(renderTemplate(t,{discountCents:125025,name:'$& {{discount}}',quoteNumber:'42'}).body).toBe('Hi $& {{discount}}, quote 42: $1250.25.');
});
it('requires email subject and rejects multiline subjects',()=>{const t=defaultTemplates();const index=t.findIndex(x=>x.channel==='email');for(const subject of ['', 'Hi\nthere'])expect(()=>validateTemplates(t.map((v,i)=>i===index?{...v,subject}:v))).toThrow();});
