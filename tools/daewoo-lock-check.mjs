import assert from 'node:assert/strict';
import { prepareDaewooLock, settlementCover, checkBankConfirmation } from '../daewoo-locks.js';
import { placeReceipts,bankFigures } from '../banking-money.js';
const scope={realmId:'fixture-realm',accountId:'7',customerId:'001'};
const covers=[{invoice_no:'COD-1',TotalCODAmount:'10000.00'}];
const input={paymentRef:'fixture-payment',on:'2026-01-02',expectedNet:'9300.00',confirmedSource:true,
 documents:[{ref:'COD-1',kind:'cod',total:'10000.00',allocated:'10000.00'},
 {ref:'CH-1',kind:'delivery',total:'500.00',allocated:'500.00'},
 {ref:'TX-1',kind:'tax',total:'200.00',allocated:'200.00',includedIn:null}]};
const lock=prepareDaewooLock(scope,covers,input,[]);
assert.equal(lock.net,'9300.00');assert.equal(lock.gross,'10000.00');assert.equal(lock.deductions,'700.00');
assert.equal(lock.reconciliation.status,'MATCH');
assert.throws(()=>prepareDaewooLock(scope,covers,{...input,expectedNet:'9999.00'},[]),/NET_DOES_NOT_MATCH/);
assert.throws(()=>prepareDaewooLock(scope,covers,{...input,confirmedSource:false},[]),/CONFIRM_SOURCE/);
assert.throws(()=>prepareDaewooLock(scope,[],input,[]),/COD_INVOICE_NOT_IN_PERIOD/);
assert.throws(()=>prepareDaewooLock(scope,[{...covers[0],TotalCODAmount:'9999.00'}],input,[]),/COD_TOTAL_CHANGED/);
assert.throws(()=>prepareDaewooLock(scope,covers,{...input,paymentRef:'other'},[lock]),/OVER_ALLOCATION/);
assert.throws(()=>prepareDaewooLock(scope,covers,{...input,paymentRef:'other',documents:input.documents.map(d=>d.ref==='CH-1'?{...d,total:'501.00'}:d)},[lock]),/DOCUMENT_TOTAL_CHANGED/);
const half={...input,paymentRef:'half-a',expectedNet:'4650.00',documents:input.documents.map(d=>({...d,allocated:String(Number(d.allocated)/2)}))};
const first=prepareDaewooLock(scope,covers,half,[]);
assert.equal(prepareDaewooLock(scope,covers,{...half,paymentRef:'half-b'},[first]).net,'4650.00');
const included={...input,documents:[input.documents[0],{ref:'CH-1',kind:'delivery',total:'700.00',allocated:'700.00'},
 {ref:'TX-1',kind:'tax',total:'200.00',allocated:'0.00',includedIn:'delivery:CH-1'}]};
assert.equal(prepareDaewooLock(scope,covers,included,[]).net,'9300.00');
const pending=settlementCover({...lock,id:'1',state:'locked',createdAt:'2026-01-02T00:00:00Z'});
assert.equal(pending.status,'approved');assert.equal(pending.approvedOn,null);
assert.throws(()=>checkBankConfirmation(lock,{amount:'9300',on:'2026-01-03',reference:''},'2026-01-04'),/BANK_REFERENCE_REQUIRED/);
assert.throws(()=>checkBankConfirmation(lock,{amount:'9300.01',on:'2026-01-03',reference:'fixture'},'2026-01-04'),/BANK_AMOUNT_DIFFERS/);
assert.throws(()=>checkBankConfirmation(lock,{amount:'9300',on:'2026-01-05',reference:'fixture'},'2026-01-04'),/FUTURE_BANK_DATE/);
const confirmation=checkBankConfirmation(lock,{amount:'9300',on:'2026-01-03',reference:'fixture'},'2026-01-04');
const paid=settlementCover({...lock,id:'1',state:'received',createdAt:'2026-01-02T00:00:00Z',bankReceipt:confirmation});
assert.equal(paid.status,'paid');assert.ok(paid.approvedOn.startsWith('2026-01-03'));
const bank={id:1,name:'Fixture',opening:'0.00',inFrom:'2026-01-01',openingIn:'0',openingOut:'0'};
const receipt=c=>({accountId:7,courier:'daewoo',cpr:c.cprNumber,status:c.status,net:c.netAmount,createdOn:'2026-01-02',paidOn:c.approvedOn?.slice(0,10)||null});
const links=[{id:1,accountId:7,bankId:1,from:'2026-01-01'}];
const figures=c=>bankFigures(bank,placeReceipts([receipt(c)],[bank],links,[],'2026-01-04'),[],{from:'2026-01-01',to:'2026-12-31'},'2026-01-04');
assert.equal(figures(pending).balance,'0.00');assert.equal(figures(pending).receivable,'9300.00');
assert.equal(figures(paid).balance,'9300.00');assert.equal(figures(paid).receivable,'0.00');
assert.equal(figures(settlementCover({...lock,id:'1',state:'reversed'})).balance,'0.00');
console.log('Daewoo locks: source totals, partial/duplicate allocations, included tax, explicit bank receipt and unchanged Banking projection PASS; synthetic only.');
