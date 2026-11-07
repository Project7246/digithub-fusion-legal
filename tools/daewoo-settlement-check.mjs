// Synthetic documents only. No network, database or financial posting.
import assert from 'node:assert/strict';
import { reconcileSettlement } from '../daewoo-finance.js';
const scope={realmId:'fixture-realm',accountId:'fixture-account',customerId:'fixture-customer'};
const document=(id,kind,total,extra={})=>({...scope,id,kind,total,...extra});
const documents=[document('cod-a','cod','10000.00'),document('delivery-a','delivery','500.00'),
  document('tax-a','tax','200.00',{includedIn:null})];
const payment=(id,amount,allocations)=>({...scope,id,amount,allocations});
const allocation=(documentId,amount)=>({documentId,amount});
const payments=[payment('payment-a','9300.00',[allocation('cod-a','10000.00'),
  allocation('delivery-a','500.00'),allocation('tax-a','200.00')])];
const original=structuredClone({documents,payments});
const result=reconcileSettlement(scope,documents,payments);
assert.equal(result.status,'MATCH');
assert.equal(result.payments[0].expectedPaisa,'930000');
assert.equal(result.payments[0].differencePaisa,'0');
assert.equal(result.allDocumentsAllocated,true);
assert.equal(result.bankReceiptVerified,false);
assert.equal(result.postingAllowed,false);
assert.deepEqual({documents,payments},original);

// A separate service invoice need not contain the same parcels or date as COD.
const crossInvoice=[...documents,document('delivery-b','delivery','100.00')];
const crossPayment=[payment('payment-b','9200.00',[...payments[0].allocations,allocation('delivery-b','100.00')])];
assert.equal(reconcileSettlement(scope,crossInvoice,crossPayment).status,'MATCH');

// A tax breakdown already inside a delivery invoice is never deducted twice.
const included=[document('cod-a','cod','10000.00'),document('delivery-a','delivery','700.00'),
  document('tax-a','tax','200.00',{includedIn:'delivery-a'})];
const includedPayment=[payment('payment-a','9300.00',[allocation('cod-a','10000.00'),allocation('delivery-a','700.00')])];
assert.equal(reconcileSettlement(scope,included,includedPayment).status,'MATCH');
assert.throws(()=>reconcileSettlement(scope,included,payments),/INCLUDED_TAX_ALLOCATION/);

// Partial invoice allocations are valid; outstanding balance stays explicit.
const partial=[payment('part-a','4650.00',[allocation('cod-a','5000.00'),allocation('delivery-a','250.00'),allocation('tax-a','100.00')])];
const part=reconcileSettlement(scope,documents,partial);
assert.equal(part.status,'MATCH');assert.equal(part.allDocumentsAllocated,false);
assert.equal(part.documents.find(d=>d.id==='cod-a').remainingPaisa,'500000');
assert.equal(reconcileSettlement(scope,documents,[...partial,payment('part-b','4650.00',partial[0].allocations)]).allDocumentsAllocated,true);
assert.throws(()=>reconcileSettlement(scope,documents,[...payments,payment('again','9300.00',payments[0].allocations)]),/OVER_ALLOCATION/);

const difference=reconcileSettlement(scope,documents,[{...payments[0],amount:'9299.99'}]);
assert.equal(difference.status,'DIFFERENT');assert.equal(difference.payments[0].differencePaisa,'-1');
const missing=reconcileSettlement(scope,documents,[{...payments[0],allocations:[]}]);
assert.equal(missing.status,'UNVERIFIED');
assert.equal(reconcileSettlement(scope,documents,[]).status,'UNVERIFIED');
assert.throws(()=>reconcileSettlement(scope,documents,[payment('missing','1.00',[allocation('unknown','1.00')])]),/DOCUMENT_NOT_FOUND/);
assert.throws(()=>reconcileSettlement(scope,documents,[...payments,payments[0]]),/DUPLICATE_PAYMENT/);
assert.throws(()=>reconcileSettlement(scope,[...documents,documents[0]],payments),/DUPLICATE_DOCUMENT/);
assert.throws(()=>reconcileSettlement(scope,[{...documents[0],realmId:'other'}],[]),/SCOPE_MISMATCH/);
assert.throws(()=>reconcileSettlement(scope,documents,[{...payments[0],accountId:'other'}]),/SCOPE_MISMATCH/);
assert.throws(()=>reconcileSettlement(scope,documents,[{...payments[0],customerId:'other'}]),/SCOPE_MISMATCH/);
assert.throws(()=>reconcileSettlement(scope,[document('tax','tax','1.00')],[]),/TAX_BASIS_REQUIRED/);
assert.throws(()=>reconcileSettlement(scope,[document('tax','tax','1.00',{includedIn:'missing'})],[]),/TAX_PARENT_REQUIRED/);
assert.throws(()=>reconcileSettlement(scope,[document('cod','cod',null)],[]),/AMOUNT_REQUIRED/);
assert.throws(()=>reconcileSettlement(scope,[document('cod','cod','0.001')],[]),/AMOUNT_REQUIRED/);
assert.throws(()=>reconcileSettlement(scope,documents,[payment('bad','0.00',[allocation('cod-a','-1.00')])]),/AMOUNT_REQUIRED/);
assert.throws(()=>reconcileSettlement(scope,documents,[payment('dup','0.00',[allocation('cod-a','1.00'),allocation('cod-a','1.00')])]),/DUPLICATE_ALLOCATION/);
// Exact minor units, including known zero; no floating-point subtraction.
assert.equal(reconcileSettlement(scope,[document('tiny','cod','0.30')],[payment('tiny','0.30',[allocation('tiny','0.30')])]).status,'MATCH');
assert.equal(reconcileSettlement(scope,[document('zero','cod','0.00')],[payment('zero','0.00',[allocation('zero','0.00')])]).status,'MATCH');
console.log('Daewoo settlements: separate COD/delivery/tax invoices, explicit payment links, partial allocations, no double tax, exact paisa, scope and missing data PASS; synthetic only.');
