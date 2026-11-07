import { reconcileSettlement } from './daewoo-finance.js';
import { money,addMoney } from './banking-money.js';
import { validateRange } from './daewoo-portal.js';
const fail=code=>{throw new Error(code);};
export function lockMoney(value){
  if(value==null||value==='')fail('AMOUNT_REQUIRED');
  const text=String(value).trim().replace(/,/g,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(text)||money(text)>99999999999999n)fail('INVALID_AMOUNT');
  return addMoney([text]);
}
function ref(value){const text=String(value??'').trim();if(!text||text.length>120||/[\x00-\x1f]/.test(text))fail('REFERENCE_REQUIRED');return text;}
function date(value){validateRange(value,value);return value;}

export function prepareDaewooLock(scope,covers,input,previous){
  if(input.confirmedSource!==true)fail('CONFIRM_SOURCE');
  if(!Array.isArray(input.documents)||!input.documents.length)fail('DOCUMENTS_REQUIRED');
  const paymentRef=ref(input.paymentRef),on=date(input.on),net=lockMoney(input.expectedNet);
  const documents=input.documents.map(d=>{
    if(!['cod','delivery','tax'].includes(d.kind))fail('DOCUMENT_KIND_REQUIRED');
    const reference=ref(d.ref),total=lockMoney(d.total),allocated=lockMoney(d.allocated);
    if(money(allocated)>money(total))fail('OVER_ALLOCATION');
    if(d.kind==='cod'){
      const matches=covers.filter(c=>String(c.invoice_no)===reference);
      if(!matches.length)fail('COD_INVOICE_NOT_IN_PERIOD');
      if(matches.some(c=>lockMoney(c.TotalCODAmount)!==total))fail('COD_TOTAL_CHANGED');
    }
    if(d.kind==='tax'&&d.includedIn!==null&&typeof d.includedIn!=='string')fail('TAX_BASIS_REQUIRED');
    if(d.kind==='tax'&&d.includedIn!==null&&money(allocated)!==0n)fail('INCLUDED_TAX_ALLOCATION');
    return {...scope,id:d.kind+':'+reference,ref:reference,kind:d.kind,total,allocated,
      ...(d.kind==='tax'?{includedIn:d.includedIn}:{}),source:d.kind==='cod'?'portal-cover':'owner-verified-invoice'};
  });
  if(new Set(documents.map(d=>d.id)).size!==documents.length)fail('DUPLICATE_DOCUMENT');
  const payment={...scope,id:paymentRef,amount:net,allocations:documents
    .filter(d=>!(d.kind==='tax'&&d.includedIn!==null)).map(d=>({documentId:d.id,amount:d.allocated}))};
  const all=new Map();
  for(const doc of [...previous.flatMap(l=>l.documents),...documents]){
    const old=all.get(doc.id);
    if(old&&(old.total!==doc.total||old.kind!==doc.kind||old.includedIn!==doc.includedIn))fail('DOCUMENT_TOTAL_CHANGED');
    all.set(doc.id,doc);
  }
  const reconciliation=reconcileSettlement(scope,[...all.values()],[...previous.map(l=>l.payment),payment]);
  if(reconciliation.status!=='MATCH')fail('NET_DOES_NOT_MATCH');
  const current=reconciliation.payments.at(-1);
  if(current.status!=='MATCH')fail('NET_DOES_NOT_MATCH');
  const gross=lockMoney(addMoney(payment.allocations.filter(a=>a.documentId.startsWith('cod:')).map(a=>a.amount)));
  const deductions=lockMoney(addMoney(payment.allocations.filter(a=>!a.documentId.startsWith('cod:')).map(a=>a.amount)));
  return {scope,paymentRef,on,net,gross,deductions,documents,payment,
    reconciliation:{status:current.status,payment:current},
    sourceCovers:covers.filter(c=>documents.some(d=>d.kind==='cod'&&d.ref===String(c.invoice_no)))};
}
export function checkBankConfirmation(lock,input,today){
  const amount=lockMoney(input.amount),on=date(input.on);
  if(!String(input.reference??'').trim())fail('BANK_REFERENCE_REQUIRED');
  if(on>today)fail('FUTURE_BANK_DATE');
  if(amount!==lock.net)fail('BANK_AMOUNT_DIFFERS');
  return {amount,on,reference:ref(input.reference)};
}
export function settlementCover(lock){
  return {cprNumber:'DW-SETTLEMENT-'+lock.id,status:lock.state==='received'?'paid':lock.state==='reversed'?'cancelled':'approved',
    netAmount:lock.net,grossAmount:lock.gross,chargeAmount:lock.deductions,
    createdOn:lock.on+'T00:00:00+05:00',approvedOn:lock.state==='received'?lock.bankReceipt.on+'T00:00:00+05:00':null,
    instrument:lock.bankReceipt?.reference||null,mode:'Daewoo invoice match',
    raw:{daewooSettlement:{id:lock.id,paymentRef:lock.paymentRef,state:lock.state,documents:lock.documents,
      bankReceipt:lock.bankReceipt||null,net:lock.net,gross:lock.gross,deductions:lock.deductions}}};
}
