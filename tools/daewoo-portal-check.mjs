// Synthetic sessions and money only: no network or production account access.
import assert from 'node:assert/strict';
import { DaewooPortal, compareInvoiceFigures, validateRange, chooseCustomer } from '../daewoo-portal.js';

const cover={customer_id:7,TotalCODAmount:'10000.00',TotalServiceCharges:'500.00',TotalReimbursementAmount:'9500.00'};
const detail=[{booking_id:'0001',invoice_no:'fixture-invoice',amount_cod:'6000.00',amount_wr:'300.00',RST_Amt:'20.00',RWHT_Amt:'30.00'},
  {booking_id:'0002',invoice_no:'fixture-invoice',amount_cod:'4000.00',amount_wr:'200.00',RST_Amt:'10.00',RWHT_Amt:'15.00'}];
assert.deepEqual(compareInvoiceFigures(cover,detail),{codMatches:true,chargesMatch:true,coverArithmeticMatches:true,taxFieldsPresent:true,duplicateParcel:false,settlementStatus:'NOT_CHECKED'});
const originalCover=structuredClone(cover),originalDetail=structuredClone(detail);
compareInvoiceFigures(cover,detail);
assert.deepEqual(cover,originalCover);assert.deepEqual(detail,originalDetail,'never adjust original totals to force a match');
assert.equal(compareInvoiceFigures({...cover,TotalCODAmount:'9999.99'},detail).settlementStatus,'NOT_CHECKED');
assert.equal(compareInvoiceFigures({...cover,TotalCODAmount:null},detail).settlementStatus,'NOT_CHECKED');
assert.equal(compareInvoiceFigures({...cover,TotalCODAmount:'9999.99'},detail).codMatches,false);
assert.equal(compareInvoiceFigures({...cover,TotalCODAmount:null},detail).codMatches,null);
assert.equal(compareInvoiceFigures(cover,[{...detail[0],amount_cod:null}]).codMatches,null);
assert.equal(compareInvoiceFigures(cover,[detail[0],detail[0]]).duplicateParcel,true);
assert.equal(compareInvoiceFigures(cover,[{...detail[0],RST_Amt:null}]).taxFieldsPresent,false);
assert.equal(compareInvoiceFigures({...cover,TotalCODAmount:'10.001'},detail).codMatches,null);
assert.equal(compareInvoiceFigures({TotalCODAmount:0,TotalServiceCharges:0,TotalReimbursementAmount:0},[]).codMatches,true);
validateRange('2026-01-01','2026-01-03');
validateRange('2026-01-01','2026-01-31');
validateRange('2026-01-01','2026-02-01');
for(const [from,to] of [['2026-02-30','2026-03-01'],['2026-01-02','2026-01-01']])assert.throws(()=>validateRange(from,to),/DATE_RANGE/);
const choices=[{customer_id:7,customer_name:'Fixture Alpha COD'},
  {customer_id:8,customer_name:'Fixture Alpha Cargo'},{customer_id:9,customer_name:'Fixture Beta'}];
assert.equal(chooseCustomer(choices).status,'REQUIRED');
assert.equal(chooseCustomer(choices,'  fixture alpha cod ').customer.customer_id,7);
assert.equal(chooseCustomer(choices,'8').customer.customer_id,8);
assert.equal(chooseCustomer(choices,'beta').customer.customer_id,9);
assert.equal(chooseCustomer(choices,'alpha').status,'AMBIGUOUS');
assert.equal(chooseCustomer(choices,'outside-fixture').status,'NOT_FOUND');
assert.equal(chooseCustomer(choices,'al').status,'NOT_FOUND');
assert.equal(chooseCustomer([]).status,'EMPTY');
assert.equal(chooseCustomer([choices[0],{...choices[0],customer_id:'7'}]).customer.customer_id,7);
assert.equal(chooseCustomer([{customer_id:0,customer_name:'ALL'},choices[0]]).customer.customer_id,7);
assert.equal(chooseCustomer(choices,'0').status,'NOT_FOUND');

function fixture(options={}) {
  const calls=[];
  const portal=new DaewooPortal({fetcher:async(url,request)=>{
    calls.push({url,request});
    const path=new URL(url).pathname;
    if(options.redirect)return new Response('',{status:302,headers:{location:'https://outside.invalid/'}});
    if(options.html)return new Response('<html>fixture</html>');
    if(options.large)return new Response(' '.repeat(4*1024*1024+1));
    if(path==='/Login.aspx')return new Response('<html>Login</html>',{headers:{'set-cookie':'ASP.NET_SessionId=fixture-session; Path=/; HttpOnly; Secure'}});
    assert.match(request.headers.Cookie||'',/ASP.NET_SessionId=fixture-session/);
    if(path==='/CODInvoiceSummaryReportPrint.aspx')return new Response('%PDF-1.4\nfixture invoice',{headers:{'Content-Type':'application/pdf'}});
    const method=path.split('/').pop();
    let body={Success:true};
    if(options.expired && method==='CheckUserSessionUpdated')body={Success:false,SessionExpired:true};
    if(options.reject && method==='AuthenticateUser')body={Success:false,Response:'fixture private password'};
    if(method==='GetCustomersNew')body.Data=[{customer_id:7,customer_name:'Fixture'}];
    if(method==='GetReport'){
      body.Data=[{...cover,invoice_no:'fixture-invoice',customer_id:options.foreign?8:7}];
      if(options.monthly){
        const range=JSON.parse(request.body);
        body.Data=['2026-01-01','2026-01-07','2026-01-08','2026-01-31']
          .filter(date=>date>=range.fromDate&&date<=range.toDate)
          .map(date=>({...cover,invoice_no:'fixture-'+date,invoice_date:date}));
      }
    }
    if(method==='GetDetailReport')body.Data=options.foreignInvoice?detail.map(row=>({...row,invoice_no:'other-fixture'})):detail;
    if(method==='GetFinancialReport')body.Data=JSON.stringify([{booking_id:'fixture-booking',BarCode:'0000123',
      Service_invoice_no:'fixture-service',Payment_invoice_no:'fixture-cod',
      amount_cod:'100.00',amount_wr:'10.00',AmountToPaid:'100.00',AmountPaid2:null,
      ...(options.foreign?{customer_id:8}:{})}]);
    return Response.json({d:options.stringWrapper?JSON.stringify(body):body});
  }});
  return {portal,calls};
}
const {portal,calls}=fixture();
await portal.login('fixture-user','fixture-private-password');
assert.equal((await portal.customers())[0].customer_id,7);
const covers=await portal.covers('2026-01-01','2026-01-03',7);
assert.equal(covers.length,1);
assert.equal((await portal.detail('fixture-invoice',7)).length,2);
const financial=await portal.financialRows('2026-01-01','2026-01-31',7);
assert.equal(financial[0].Service_invoice_no,'fixture-service');
assert.equal(financial[0].Payment_invoice_no,'fixture-cod');
assert.equal(financial[0].AmountPaid2,null,'invoice reference does not turn missing paid amount into zero');
assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/GetFinancialReport')).request.body),
  {fromDate:'2026-01-01',toDate:'2026-01-31',customerId:'7'});
assert.ok((await portal.invoiceExport('fixture-invoice',7)).toString().startsWith('%PDF-'));
const exportCall=calls.find(c=>new URL(c.url).pathname==='/CODInvoiceSummaryReportPrint.aspx');
assert.equal(exportCall.request.method,'GET');
assert.deepEqual(Object.fromEntries(new URL(exportCall.url).searchParams),{invoiceNo:'fixture-invoice',customer:'7',isExport:'1',isInvoiceExport:'1'});
assert.ok(calls.every(c=>new URL(c.url).origin==='https://codportal.daewoo.net.pk'));
assert.ok(calls.every(c=>c.request.redirect==='manual'));
assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/AuthenticateUser')).request.body),{userName:'fixture-user',password:'fixture-private-password'});
assert.deepEqual(JSON.parse(calls.find(c=>c.url.endsWith('/GetReport')).request.body),{fromDate:'2026-01-01',toDate:'2026-01-03',customerId:'7'});
portal.close();
await assert.rejects(portal.customers(),e=>e.code==='LOGIN_REQUIRED');
for(const [option,code] of [['reject','AUTH_REJECTED'],['expired','SESSION_EXPIRED'],['redirect','REDIRECT_REFUSED'],['html','BAD_RESPONSE'],['large','RESPONSE_TOO_LARGE']]) {
  const f=fixture({[option]:true});
  await assert.rejects(f.portal.login('fixture','fixture'),e=>e.code===code && !e.message.includes('private'));
  f.portal.close();
}
const foreign=fixture({foreign:true});await foreign.portal.login('fixture','fixture');
await assert.rejects(foreign.portal.covers('2026-01-01','2026-01-03',7),e=>e.code==='CUSTOMER_SCOPE_MISMATCH');
await assert.rejects(foreign.portal.financialRows('2026-01-01','2026-01-31',7),e=>e.code==='CUSTOMER_SCOPE_MISMATCH');
const string=fixture({stringWrapper:true});await string.portal.login('fixture','fixture');assert.equal((await string.portal.customers()).length,1);
const wrongInvoice=fixture({foreignInvoice:true});await wrongInvoice.portal.login('fixture','fixture');
await assert.rejects(wrongInvoice.portal.detail('fixture-invoice',7),e=>e.code==='INVOICE_SCOPE_MISMATCH');
const unauth=fixture();await assert.rejects(unauth.portal.detail('x',7),e=>e.code==='LOGIN_REQUIRED');assert.equal(unauth.calls.length,0);
await assert.rejects(unauth.portal.invoiceExport('x',7),e=>e.code==='LOGIN_REQUIRED');assert.equal(unauth.calls.length,0);
const monthly=fixture({monthly:true});await monthly.portal.login('fixture','fixture');
const fullMonth=await monthly.portal.covers('2026-01-01','2026-01-31',7);
const fullRequest=JSON.parse(monthly.calls.find(c=>c.url.endsWith('/GetReport')).request.body);
assert.deepEqual(fullRequest,{fromDate:'2026-01-01',toDate:'2026-01-31',customerId:'7'});
assert.equal(fullMonth.length,4);assert.ok(fullMonth.some(c=>c.invoice_date==='2026-01-31'));
const partitioned=[];
for(const [from,to] of [['2026-01-01','2026-01-07'],['2026-01-08','2026-01-14'],['2026-01-15','2026-01-21'],['2026-01-22','2026-01-28'],['2026-01-29','2026-01-31']])partitioned.push(...await monthly.portal.covers(from,to,7));
assert.deepEqual(partitioned,fullMonth,'monthly access preserves exactly the combined full range');
console.log('Daewoo portal: auth/scope, complete monthly range, exact paisa/missing values and mismatch checks PASS; no network.');
