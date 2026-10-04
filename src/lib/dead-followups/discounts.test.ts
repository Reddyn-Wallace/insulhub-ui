import {expect,it} from 'vitest';
import {quoteDiscounts} from './discounts';
it('flags every negative extra without netting it against positive extras',()=>{
 const result=quoteDiscounts({extras:[{name:'Promo',price:-500},{name:'Access',price:1000},{name:'Courtesy',price:-125.5},{name:'No charge',price:0}]});
 expect(result.totalCents).toBe(62550);expect(result.items).toEqual([{name:'Promo',cents:50000},{name:'Courtesy',cents:12550}]);
});
it('has no discount when extras are absent or non-negative',()=>{expect(quoteDiscounts(null).totalCents).toBe(0);expect(quoteDiscounts({extras:[{price:100}]}).items).toEqual([]);});
