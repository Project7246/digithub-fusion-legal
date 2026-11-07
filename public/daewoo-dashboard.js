(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var main='parcels',sub='summary',orders=[],covers=[],details=[],settlements=null,data=[],page=0,serial=0,controller=null,loaded=false;
var tabs={parcels:[['summary','Summary'],['days','Day by day'],['status','Every status'],['cities','Cities'],['handed','Handed over'],['carriers','By carrier']],
 finance:[['statement','Statement'],['months','By month'],['ageing','Ageing'],['carriers','By carrier'],['cprs','CPRs'],['pending','Not collected'],['cities','Cities'],['charges','Delivery / tax invoices'],['matching','Invoice matching']],
 receipts:[['cprs','CPRs'],['charges','Delivery charges'],['detail','Invoice details / tax'],['matching','Invoice matching']]};
var cols={parcels:[['Tracking / CN','booking_id'],['Barcode','BarCode'],['Order reference','reference_no'],['Status','status'],['Booked','booking_datetime_f'],['Destination','DestinationTerminal']],
 cprs:[['CPR / COD invoice','invoice_no'],['Invoice date','invoice_date'],['Period from','invoice_period_start_date'],['Period to','invoice_period_end_date'],['Reported COD','TotalCODAmount'],['Reported charges','TotalServiceCharges'],['Reported reimbursement','TotalReimbursementAmount']],
 charges:[['Tracking / CN','booking_id'],['Service invoice','Service_invoice_no'],['Reported charges','amount_wr'],['Payment invoice','Payment_invoice_no'],['Invoice status','invoice_status']],
 detail:[['Tracking / CN','booking_id'],['Barcode','Barcode'],['COD','amount_cod'],['Charges','amount_wr'],['RST','RST_Amt'],['WHT','RWHT_Amt']],
 counts:[['Group','group'],['Parcels','count']],months:[['Month','group'],['CPRs','count'],['Reported COD','total']],
 statement:[['Description','label'],['Selected period','value'],['All time','allTime']]};
function display(v){if(v==null||v==='')return 'Unavailable';var m=String(v).match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);return m?new Date(Number(m[1])).toLocaleDateString('en-GB',{timeZone:'Asia/Karachi'}):String(v);}
function day(v){var m=String(v||'').match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);if(m)return new Date(Number(m[1])).toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});m=String(v||'').match(/^\d{4}-\d{2}-\d{2}/);return m?m[0]:null;}
function sum(rows,key){var n=0n;for(var r of rows){if(r[key]==null||r[key]==='')return null;var m=String(r[key]).replace(/,/g,'').match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!m)return null;n+=BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'));}return n/100n+'.'+String(n%100n).padStart(2,'0');}
function unique(){var map=new Map();orders.forEach(function(r){var id=String(r.booking_id);var old=map.get(id);if(!old)map.set(id,Object.assign({},r));else if(old.status!==r.status){old.status='Multiple source statuses — review';old.fusionStatusGroup='other';} });return Array.from(map.values());}
function grouped(rows,key,moneyKey){var map=new Map();rows.forEach(function(r){var k=key(r)||'Unavailable';if(!map.has(k))map.set(k,[]);map.get(k).push(r);});return Array.from(map).map(function(x){return {group:x[0],count:x[1].length,total:moneyKey?sum(x[1],moneyKey):null};});}
function accountLabel(){var s=$('account');return s.options&&s.selectedIndex>=0?s.options[s.selectedIndex].textContent:'Daewoo';}
function clear(){serial++;if(controller)controller.abort();loaded=false;orders=[];covers=[];details=[];settlements=null;data=[];page=0;$('message').textContent='';render();}
function choose(next){serial++;if(controller)controller.abort();$('load').disabled=!$('account').value;sub=next;page=0;$('back').hidden=sub!=='detail';render();}
function cards(rows){$('cards').replaceChildren();rows.forEach(function(r){var card=document.createElement('div');card.className='card';var label=document.createElement('div');label.className='k';label.textContent=r[0];var value=document.createElement('div');value.className='v';value.textContent=r[1];card.appendChild(label);card.appendChild(value);$('cards').appendChild(card);});}
function render(){
 document.querySelectorAll('[data-main]').forEach(function(b){b.classList.toggle('on',b.dataset.main===main);});
 $('subTabs').replaceChildren();tabs[main].forEach(function(t){var b=document.createElement('button');b.textContent=t[1];b.classList.toggle('on',sub===t[0]);b.onclick=function(){if(t[0]==='matching'){location.href='/banking?view=daewoo&account='+encodeURIComponent($('account').value);return;}choose(t[0]);};$('subTabs').appendChild(b);});
 var list=unique(),columns=cols.parcels;data=list;
 if(main==='parcels'){
  cards(loaded?[['Parcels',list.length],['Delivered',list.filter(function(r){return r.fusionStatusGroup==='delivered';}).length],['Returned',list.filter(function(r){return r.fusionStatusGroup==='returned';}).length],['Moving',list.filter(function(r){return !['delivered','returned','cancelled','expired','lost','damaged'].includes(r.fusionStatusGroup);}).length]]:[]);
  if(sub==='days'){data=grouped(list,function(r){return day(r.booking_datetime_f);});columns=cols.counts;}
  if(sub==='status'){data=grouped(list,function(r){return r.status;});columns=cols.counts;}
  if(sub==='cities'){data=grouped(list,function(r){return r.DestinationTerminal;});columns=cols.counts;}
  if(sub==='handed')data=[];
  if(sub==='carriers'){data=loaded?[{group:accountLabel(),count:list.length}]:[];columns=cols.counts;}
 }else{
  cards(loaded?[['COD / CPR invoices',covers.length],['Matched net pending',settlements===null?'Unavailable':sum(settlements.filter(function(l){return l.state==='locked';}),'net')],['Bank receipts confirmed',settlements===null?'Unavailable':sum(settlements.filter(function(l){return l.state==='received';}),'net')]]:[]);
  data=covers;columns=cols.cprs;
  var locked=(settlements||[]).filter(function(l){return l.state==='locked';}),received=(settlements||[]).filter(function(l){return l.state==='received';});
  function inPeriod(l){var d=l.state==='received'?l.paidOn:l.on;return d&&d>=$('from').value&&d<=$('to').value;}
  if(sub==='statement'){data=loaded?[{label:'Reported COD on invoice covers',value:sum(covers,'TotalCODAmount'),allTime:null},{label:'Reported service charges on these covers',value:sum(covers,'TotalServiceCharges'),allTime:null},{label:'Matched CPR net still pending',value:settlements===null?null:sum(locked.filter(inPeriod),'net'),allTime:settlements===null?null:sum(locked,'net')},{label:'Matched bank receipts confirmed',value:settlements===null?null:sum(received.filter(inPeriod),'net'),allTime:settlements===null?null:sum(received,'net')},{label:'Delivered with no matched CPR / unallocated net',value:null,allTime:null}]:[];columns=cols.statement;}
  if(sub==='months'){data=grouped((settlements||[]).filter(function(l){return l.state!=='reversed'&&inPeriod(l);}),function(l){return (l.paidOn||l.on).slice(0,7)+' · '+l.state;},'net');columns=[['Month / state','group'],['Matched payments','count'],['Matched net','total']];}
  if(sub==='ageing'){var today=new Date();data=grouped(locked,function(l){var age=Math.floor((today-new Date(l.on+'T00:00:00+05:00'))/86400000);return age<0?'Future date':age<=7?'0–7 days':age<=30?'8–30 days':'Over 30 days';},'net');columns=[['Age of pending CPR','group'],['Matched payments','count'],['Pending net','total']];}
  if(sub==='carriers'){data=loaded?[{group:accountLabel(),count:covers.length,total:settlements===null?null:sum(locked,'net')}]:[];columns=[['Carrier / account','group'],['Source CPR invoices','count'],['Matched net pending','total']];}
  if(sub==='pending'){data=list.filter(function(r){return ['booked','unbooked'].includes(r.fusionStatusGroup);});columns=cols.parcels;}
  if(sub==='cities'){data=grouped(list,function(r){return r.DestinationTerminal;});columns=[['City / destination','group'],['Parcels','count'],['Net receivable','total']];}
  if(sub==='charges'){data=orders;columns=cols.charges;}
  if(sub==='detail'){data=details;columns=cols.detail;}
 }
 $('tableTitle').textContent=(tabs[main].find(function(t){return t[0]===sub;})||['','Parcels'])[1];
 $('coverage').textContent=main==='parcels'?(sub==='handed'?'Unavailable: this source report does not provide verified pickup dates.':'Unique booking numbers in the selected report. Conflicting source statuses remain flagged for review.'):['months','ageing','carriers'].includes(sub)?'Matched payments only. Unallocated invoices and delivered parcels without verified CPR allocations remain unavailable; they are not treated as zero.':sub==='cities'?'City-level net receivable is unavailable until invoice deductions can be allocated to individual parcels.':sub==='detail'?'Original invoice detail: RST/WHT are shown as reported. A tax already included in a delivery invoice must not be deducted again.':'COD covers, service/tax invoices and payments remain separate. Match payment allocations in Banking to establish net receivable and confirm an actual bank receipt. No QuickBooks posting is made here.';
 table(columns);
}
function table(columns){
 var query=$('search').value.trim().toLowerCase(),filtered=data.filter(function(r){return columns.some(function(c){return display(r[c[1]]).toLowerCase().includes(query);});});page=Math.min(page,Math.max(0,Math.ceil(filtered.length/50)-1));
 $('head').replaceChildren();var hr=document.createElement('tr');columns.forEach(function(c){var th=document.createElement('th');th.textContent=c[0];hr.appendChild(th);});$('head').appendChild(hr);$('rows').replaceChildren();
 filtered.slice(page*50,page*50+50).forEach(function(row){var tr=document.createElement('tr');columns.forEach(function(c){var td=document.createElement('td');if(c[1]==='invoice_no'){var b=document.createElement('button');b.className='mini';b.textContent=display(row.invoice_no);b.onclick=function(){readDetail(row.invoice_no);};td.appendChild(b);}else td.textContent=display(row[c[1]]);tr.appendChild(td);});$('rows').appendChild(tr);});
 $('empty').hidden=filtered.length>0;$('empty').textContent=loaded?'No rows for this view.':'Load the selected account and period.';$('count').textContent=filtered.length+' rows'+(filtered.length?' · page '+(page+1)+' / '+Math.ceil(filtered.length/50):'');$('prev').disabled=page===0;$('next').disabled=(page+1)*50>=filtered.length;
}
async function get(url,signal){var response=await fetch(url,{cache:'no-store',signal:signal});var result=await response.json();if(!response.ok)throw new Error(result.error||'Report unavailable.');return result;}
function query(){return new URLSearchParams({account:$('account').value,from:$('from').value,to:$('to').value});}
async function read(){
 if(!$('account').value)return;if(!$('from').value||!$('to').value||$('from').value>$('to').value){$('message').textContent='Choose a valid period.';return;}
 var current=++serial;if(controller)controller.abort();controller=new AbortController();$('load').disabled=true;$('message').textContent='Reading the courier…';loaded=false;orders=[];covers=[];details=[];render();
 try{var result=await get('/api/daewoo/dashboard?'+query(),controller.signal);if(current!==serial)return;orders=result.orders||[];covers=result.covers||[];settlements=result.settlements||null;loaded=true;render();$('message').textContent='Read from Daewoo · '+new Date().toLocaleString();}
 catch(error){if(current!==serial||error.name==='AbortError')return;$('message').textContent=error.message;}
 finally{if(current===serial)$('load').disabled=false;}
}
async function readDetail(invoice){
 var current=++serial;if(controller)controller.abort();controller=new AbortController();var q=query();q.set('invoice',invoice);$('message').textContent='Reading the invoice…';
 try{var result=await get('/api/daewoo/detail?'+q,controller.signal);if(current!==serial)return;details=result.rows||[];main='receipts';choose('detail');$('back').hidden=false;$('message').textContent='Selected invoice detail.';}catch(error){if(current===serial&&error.name!=='AbortError')$('message').textContent=error.message;}
}
function range(days){var to=new Date(),from=new Date();from.setDate(from.getDate()-days);$('from').value=from.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});$('to').value=to.toLocaleDateString('en-CA',{timeZone:'Asia/Karachi'});}
document.querySelectorAll('[data-main]').forEach(function(b){b.onclick=function(){main=b.dataset.main;choose(main==='parcels'?'summary':main==='finance'?'statement':'cprs');if(!loaded)read();};});
document.querySelectorAll('[data-days]').forEach(function(b){b.onclick=function(){range(Number(b.dataset.days));document.querySelectorAll('[data-days]').forEach(function(x){x.classList.toggle('on',x===b);});$('picker').classList.add('hide');read();};});
$('btnPick').onclick=function(){$('picker').classList.toggle('hide');};
['from','to'].forEach(function(id){$(id).onchange=function(){clear();read();};});
$('account').onchange=function(){clear();$('ttl').textContent=accountLabel();if(window.history)window.history.replaceState(null,'','/daewoo?account='+encodeURIComponent(this.value));read();};$('load').onclick=read;$('back').onclick=function(){choose('cprs');};$('search').oninput=function(){page=0;render();};$('prev').onclick=function(){page--;render();};$('next').onclick=function(){page++;render();};
window.APP.ready.then(async function(){
 range(6);try{var result=await get('/api/daewoo/accounts');var wanted=new URLSearchParams(location.search).get('account');result.accounts.forEach(function(a){var o=document.createElement('option');o.value=a.id;o.textContent=a.label;$('account').appendChild(o);});
 if(wanted&&result.accounts.some(function(a){return String(a.id)===wanted;}))$('account').value=wanted;
 $('load').disabled=!result.accounts.length;$('ttl').textContent=result.accounts.length?accountLabel():'Daewoo';$('sourceNote').textContent='Daewoo · same courier dashboard, source reports kept separate';
 if(!result.accounts.length){$('message').textContent='Add a Daewoo account to open its reports.';render();}else read();
 }catch(error){$('message').textContent=error.message;$('load').disabled=true;}
});
})();
