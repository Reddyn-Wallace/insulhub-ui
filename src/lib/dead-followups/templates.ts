import {ControlError} from './controls';
export type OfferTemplate={channel:'sms'|'email';approach:1|2;subject:string;body:string};
export type TemplateRecord={revision:number;templates:OfferTemplate[];actorName:string;updatedAt:string|null};
export function defaultTemplates():OfferTemplate[]{
 return (['sms','email'] as const).flatMap(channel=>([1,2] as const).map(approach=>({channel,approach,subject:channel==='email'?'Your insulation quote':'',body:approach===1?'Hi {{name}}, just following up on your insulation quote. We can offer a discount of {{discount}}. Would you like us to revisit the quote and confirm the scope and pricing with you? Thanks, InsulHub':'Hi {{name}}, following up on our earlier insulation offer. We can offer a discount of {{discount}}. Are you still interested in proceeding? We can confirm the scope and pricing with you. Thanks, InsulHub'})));
}
export function validateTemplates(input:unknown):OfferTemplate[]{
 if(!Array.isArray(input)||input.length!==4)throw new ControlError('Save first and second templates for both SMS and email.');
 const keys=new Set<string>();
 return input.map(value=>{
  if(!value||!['sms','email'].includes(value.channel)||![1,2].includes(value.approach))throw new ControlError('Invalid template.');
  const key=value.channel+value.approach;if(keys.has(key))throw new ControlError('Each approach and channel needs one template.');keys.add(key);
  if(typeof value.body!=='string'||!value.body.includes('{{discount}}')||value.body.length>(value.channel==='sms'?1400:18000)||value.body.includes('\0'))throw new ControlError('Include {{discount}} and keep the template within its message limit.');
  if(typeof value.subject!=='string'||value.subject.length>180||/[\r\n\0]/.test(value.subject)||(value.channel==='email'&&!value.subject.trim()))throw new ControlError('Email needs a subject on one line.');
  for(const text of [value.body,value.subject])if(/[{}]/.test(text.replace(/{{(discount|name|quoteNumber)}}/g,'')))throw new ControlError('Use only {{discount}}, {{name}} and {{quoteNumber}} merge fields.');
  return {channel:value.channel,approach:value.approach,subject:value.subject,body:value.body};
 });
}
export function renderTemplate(template:OfferTemplate,input:{discountCents:number;name?:string|null;quoteNumber?:string|number|null}){
 const values={discount:'$'+(input.discountCents/100).toFixed(2),name:input.name?.trim()||'there',quoteNumber:String(input.quoteNumber??'')};
 const render=(text:string)=>text.replace(/{{(discount|name|quoteNumber)}}/g,(_match,key:keyof typeof values)=>values[key]);
 return {subject:render(template.subject),body:render(template.body)};
}
