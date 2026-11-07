const dateOnly=value=>{
  if(typeof value!=='string')return null;
  const millis=/^\/Date\((-?\d+)/.exec(value);
  if(millis)return new Date(Number(millis[1])).toISOString().slice(0,10);
  const iso=/^\d{4}-\d{2}-\d{2}/.exec(value);
  return iso?iso[0]:null;
};

const dayFirstDate=value=>{
  if(typeof value!=='string')return null;
  const match=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T].*)?$/.exec(value.trim());
  if(!match)return null;
  const day=Number(match[1]),month=Number(match[2]),year=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  return date.toISOString().slice(0,10);
};

function paisa(value){
  if(value==null)return null;const s=String(value).trim().replace(/,/g,'');
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))return null;
  const neg=s.startsWith('-'),[whole,dec='']=s.replace(/^-/,'').split('.');
  return BigInt((neg?'-':'')+whole+dec.padEnd(2,'0'));
}
function money(cents){const neg=cents<0n;const x=neg?-cents:cents;return (neg?'-':'')+(x/100n).toString()+'.'+String(x%100n).padStart(2,'0');}

export function mapDaewooOrders(rows,groupOf,details=[]){
  const seen=new Set();
  return rows.map(row=>{
    const tracking=String(row.BarCode||row.booking_id||'').trim();
    if(!tracking||seen.has(tracking))throw new Error('Daewoo duplicate or missing parcel identity');
    seen.add(tracking);
    const amount=row.amount_cod==null?null:String(row.amount_cod);
    const sourceIds=[row.BarCode,row.booking_id].filter(v=>v!=null).map(v=>String(v).trim());
    const parcelDetails=details.filter(d=>[d.booking_id,d.BarCode,d.Barcode].some(v=>v!=null&&sourceIds.includes(String(v).trim())));
    // Payment_invoice_no names the payment document, not the COD invoice used
    // by GetDetailReport. Link tax/charge rows by the COD invoice number.
    const invoiceRef=String(row.invoice_no||row.portal_ref_invoice||'').trim();
    const matching=invoiceRef?parcelDetails.filter(d=>String(d.invoice_no||'').trim()===invoiceRef):
      new Set(parcelDetails.map(d=>String(d.invoice_no||''))).size<=1?parcelDetails:[];
    const detailFee=matching.find(d=>d.amount_wr!=null)?.amount_wr;
    const fee=row.amount_wr==null?(detailFee==null?null:String(detailFee)):String(row.amount_wr);
    let taxTotal=0n,taxKnown=false;
    for(const d of matching)for(const key of ['RST_Amt','RWHT_Amt']){
      if(d[key]==null)continue;const value=paisa(d[key]);if(value===null)continue;taxKnown=true;taxTotal+=value;
    }
    const status=String(row.status||'').trim();
    return {tracking,orderRef:String(row.reference_no||row.booking_id||''),status,
      statusGroup:groupOf(status),amount,fee,tax:taxKnown?money(taxTotal):null,city:row.DestinationTerminal||null,
      bookedOn:dateOnly(row.booking_datetime_f)||dayFirstDate(row.booking_datetime_f),pickedOn:null,deliveredOn:null,weight:null,
      settled:null,settledOn:null,cprNumber:null,
      raw:{source:'daewoo-financial-report',original:row,sourcePresence:{amount:amount!==null,deliveryCharge:fee!==null,tax:taxKnown}}};
  });
}
