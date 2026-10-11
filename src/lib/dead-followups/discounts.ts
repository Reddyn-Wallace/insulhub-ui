import type {DeadQuote} from './types';
/** Extras are entered before GST in the quote calculator. Do not net away discounts with positive extras. */
export function quoteDiscounts(quote:DeadQuote['quote']){
 const items=(quote?.extras||[]).filter(extra=>typeof extra.price==='number'&&Number.isFinite(extra.price)&&extra.price<0).map(extra=>({name:extra.name?.trim()||'Discount',cents:Math.round(-extra.price!*100)}));
 return {items,totalCents:items.reduce((total,item)=>total+item.cents,0)};
}
