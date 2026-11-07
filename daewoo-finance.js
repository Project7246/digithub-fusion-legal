// Daewoo document/payment reconciliation. Pure calculation: no writes or posting.
// Source adapters must supply verified document kinds and explicit allocations.
// Never infer links from matching dates, invoice numbers, parcels or totals.
const reject=code=>{throw new Error('Daewoo settlement: '+code);};
const id=value=>typeof value==='string'&&value.trim()!==''?value:null;
const scopeKeys=['realmId','accountId','customerId'];
function money(value){
  if(typeof value!=='string'&&typeof value!=='number')reject('AMOUNT_REQUIRED');
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))reject('AMOUNT_REQUIRED');
  const text=String(value).trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))reject('AMOUNT_REQUIRED');
  const [whole,decimal='']=text.replace(/,/g,'').split('.');
  return BigInt(whole+decimal.padEnd(2,'0'));
}

export function reconcileSettlement(scope,documents,payments){
  if(!scope||scopeKeys.some(k=>!id(scope[k])))reject('SCOPE_REQUIRED');
  if(!Array.isArray(documents)||!Array.isArray(payments))reject('DOCUMENTS_REQUIRED');
  const checkScope=row=>{if(!row||scopeKeys.some(k=>row[k]!==scope[k]))reject('SCOPE_MISMATCH');};
  const docs=new Map(),paymentIds=new Set(),checked=[];
  for(const row of documents){
    checkScope(row);
    if(!id(row.id)||!['cod','delivery','tax'].includes(row.kind))reject('DOCUMENT_REQUIRED');
    if(docs.has(row.id))reject('DUPLICATE_DOCUMENT');
    if(row.kind==='tax'&&row.includedIn!==null&&!id(row.includedIn))reject('TAX_BASIS_REQUIRED');
    docs.set(row.id,{row,total:money(row.total),allocated:0n});
  }
  for(const {row} of docs.values()){
    if(row.kind==='tax'&&row.includedIn!==null){
      const parent=docs.get(row.includedIn);
      if(!parent||parent.row.kind!=='delivery')reject('TAX_PARENT_REQUIRED');
    }
  }
  for(const payment of payments){
    checkScope(payment);
    if(!id(payment.id))reject('PAYMENT_REQUIRED');
    if(paymentIds.has(payment.id))reject('DUPLICATE_PAYMENT');
    paymentIds.add(payment.id);
    const actual=money(payment.amount),allocations=payment.allocations;
    if(!Array.isArray(allocations))reject('ALLOCATION_REQUIRED');
    let expected=0n,hasCod=false;
    const seen=new Set();
    for(const link of allocations){
      const doc=docs.get(link?.documentId);
      if(!doc)reject('DOCUMENT_NOT_FOUND');
      if(seen.has(link.documentId))reject('DUPLICATE_ALLOCATION');
      seen.add(link.documentId);
      if(doc.row.kind==='tax'&&doc.row.includedIn!==null)reject('INCLUDED_TAX_ALLOCATION');
      const amount=money(link.amount);
      doc.allocated+=amount;
      if(doc.allocated>doc.total)reject('OVER_ALLOCATION');
      if(doc.row.kind==='cod'){expected+=amount;hasCod=true;}else expected-=amount;
    }
    if(expected<0n)reject('NEGATIVE_PAYMENT');
    const verified=allocations.length>0&&hasCod;
    checked.push({id:payment.id,expectedPaisa:verified?String(expected):null,
      actualPaisa:String(actual),differencePaisa:verified?String(actual-expected):null,
      status:!verified?'UNVERIFIED':actual===expected?'MATCH':'DIFFERENT'});
  }
  const balances=[...docs.values()].map(({row,total,allocated})=>({id:row.id,kind:row.kind,
    includedIn:row.kind==='tax'?row.includedIn:null,totalPaisa:String(total),allocatedPaisa:String(allocated),
    remainingPaisa:row.kind==='tax'&&row.includedIn!==null?null:String(total-allocated)}));
  return {status:checked.some(p=>p.status==='DIFFERENT')?'DIFFERENT':
    checked.length&&checked.every(p=>p.status==='MATCH')?'MATCH':'UNVERIFIED',
    payments:checked,documents:balances,
    allDocumentsAllocated:balances.length>0&&balances.every(d=>d.remainingPaisa===null||d.remainingPaisa==='0'),
    // Arithmetic/link agreement is not proof of receipt in a bank account.
    bankReceiptVerified:false,postingAllowed:false};
}
