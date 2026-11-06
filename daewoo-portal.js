// Read-only Daewoo merchant-portal client. No database, timers or global sessions.
const ORIGIN='https://codportal.daewoo.net.pk';
const LIMIT=4*1024*1024;
const METHODS=new Set(['AuthenticateUser','CheckUserSessionUpdated','GetCustomersNew','GetReport','GetDetailReport']);
export class DaewooPortalError extends Error {
  constructor(code){super('Daewoo portal: '+code);this.code=code;}
}
const fail=code=>{throw new DaewooPortalError(code);};

// Select only from this authenticated session's returned customer list.
// Do not expose names or IDs in diagnostics or silently choose the first row.
export function chooseCustomer(customers,selection=''){
  const normalize=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
  const unique=new Map();
  for(const row of customers||[]){
    const id=String(row?.customer_id??'').trim();
    if(!id||id==='0'||id==='-1')continue; // aggregate/dropdown placeholders
    if(!unique.has(id))unique.set(id,row);
  }
  const rows=[...unique.values()],query=normalize(selection);
  if(!rows.length)return {status:'EMPTY'};
  if(!query)return rows.length===1?{status:'SELECTED',customer:rows[0]}:{status:'REQUIRED'};
  const idMatch=rows.filter(row=>String(row.customer_id).trim()===String(selection).trim());
  if(idMatch.length===1)return {status:'SELECTED',customer:idMatch[0]};
  const exact=rows.filter(row=>normalize(row.customer_name)===query);
  if(exact.length===1)return {status:'SELECTED',customer:exact[0]};
  if(exact.length>1)return {status:'AMBIGUOUS'};
  const matches=query.length>=3?rows.filter(row=>normalize(row.customer_name).includes(query)):[];
  return matches.length===1?{status:'SELECTED',customer:matches[0]}:{status:matches.length?'AMBIGUOUS':'NOT_FOUND'};
}

export function validateRange(from,to) {
  const valid=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  if(!valid(from)||!valid(to))fail('DATE_RANGE');
  const days=(Date.parse(to)-Date.parse(from))/86400000;
  if(days<0||days>6)fail('DATE_RANGE'); // at most seven inclusive calendar days
}

async function readBounded(response) {
  const chunks=[];let size=0;
  if(!response.body)return '';
  for await(const chunk of response.body){
    size+=chunk.byteLength;
    if(size>LIMIT)fail('RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class DaewooPortal {
  #cookies=new Map();
  #authenticated=false;
  #fetcher;
  constructor({fetcher=fetch}={}){this.#fetcher=fetcher;}
  close(){this.#cookies.clear();this.#authenticated=false;}

  async #request(path,body,json=true){
    try {
      const headers={Accept:json?'application/json':'text/html'};
      if(this.#cookies.size)headers.Cookie=[...this.#cookies].map(([k,v])=>k+'='+v).join('; ');
      if(body!==undefined)headers['Content-Type']='application/json; charset=utf-8';
      const response=await this.#fetcher(ORIGIN+path,{method:body===undefined?'GET':'POST',
        headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(25000)});
      if(response.status>=300&&response.status<400)fail('REDIRECT_REFUSED');
      if(!response.ok)fail(response.status===429?'RATE_LIMIT':response.status===401||response.status===403?'ACCESS_REJECTED':'HTTP_ERROR');
      if(typeof response.headers.getSetCookie!=='function')fail('COOKIE_SUPPORT_REQUIRED');
      for(const cookie of response.headers.getSetCookie()){
        const pair=cookie.split(';')[0];const equal=pair.indexOf('=');
        if(equal<1)continue;
        const name=pair.slice(0,equal),value=pair.slice(equal+1);
        if(/max-age=0(?:;|$)/i.test(cookie)||!value)this.#cookies.delete(name);
        else this.#cookies.set(name,value);
      }
      const text=await readBounded(response);
      if(!json)return;
      let envelope;
      try{envelope=JSON.parse(text);}catch{fail('BAD_RESPONSE');}
      if(!envelope||!Object.hasOwn(envelope,'d'))fail('BAD_RESPONSE');
      let reply=envelope.d;
      if(reply==='User Session Expired!'||reply==='-1')fail('SESSION_EXPIRED');
      if(typeof reply==='string'){try{reply=JSON.parse(reply);}catch{fail('BAD_RESPONSE');}}
      if(reply?.SessionExpired===true)fail('SESSION_EXPIRED');
      if(!reply||typeof reply!=='object'||typeof reply.Success!=='boolean')fail('BAD_RESPONSE');
      if(Object.hasOwn(reply,'Error')&&(typeof reply.Error!=='boolean'||reply.Error===true&&reply.Success))fail('BAD_RESPONSE');
      if(!reply.Success)fail(path.endsWith('/AuthenticateUser')?'AUTH_REJECTED':'REPORT_REJECTED');
      return reply;
    }catch(error){
      if(error instanceof DaewooPortalError){
        if(error.code==='SESSION_EXPIRED')this.close();
        throw error;
      }
      // Never propagate errors containing credentials, cookies, URLs or private responses.
      fail('REQUEST_FAILED');
    }
  }
  async #call(method,body={}){
    if(!METHODS.has(method))fail('METHOD_NOT_ALLOWED');
    if(!this.#authenticated&&!['AuthenticateUser','CheckUserSessionUpdated'].includes(method))fail('LOGIN_REQUIRED');
    return this.#request('/Admin.asmx/'+method,body);
  }
  async login(userName,password){
    this.close();
    if(typeof userName!=='string'||!userName.trim()||typeof password!=='string'||!password)fail('INPUT_REQUIRED');
    try{
      await this.#request('/Login.aspx',undefined,false);
      await this.#call('AuthenticateUser',{userName,password});
      if(!this.#cookies.size)fail('COOKIE_MISSING');
      await this.#call('CheckUserSessionUpdated');
      this.#authenticated=true;
    }catch(error){this.close();throw error;}
  }
  #rows(reply){
    let rows=reply.Data;
    if(typeof rows==='string'){try{rows=JSON.parse(rows);}catch{fail('BAD_RESPONSE');}}
    if(!Array.isArray(rows))fail('BAD_RESPONSE');
    return rows;
  }
  async customers(){
    const rows=this.#rows(await this.#call('GetCustomersNew'));
    if(rows.some(r=>!r||r.customer_id==null||String(r.customer_id).trim()===''))fail('BAD_RESPONSE');
    return rows;
  }
  async covers(fromDate,toDate,customerId){
    validateRange(fromDate,toDate);
    const id=String(customerId??'');if(!id)fail('INPUT_REQUIRED');
    const rows=this.#rows(await this.#call('GetReport',{fromDate,toDate,customerId:id}));
    if(rows.some(r=>!r||r.invoice_no==null||String(r.customer_id)!==id))fail('CUSTOMER_SCOPE_MISMATCH');
    return rows;
  }
  async detail(invoiceNo,customerId){
    if(invoiceNo==null||String(invoiceNo).trim()===''||customerId==null||String(customerId).trim()==='')fail('INPUT_REQUIRED');
    const rows=this.#rows(await this.#call('GetDetailReport',{invoiceNo:String(invoiceNo),customerId:String(customerId)}));
    if(rows.some(row=>!row||row.booking_id==null||row.invoice_no==null))fail('BAD_RESPONSE');
    if(rows.some(row=>String(row.invoice_no)!==String(invoiceNo)))fail('INVOICE_SCOPE_MISMATCH');
    if(rows.some(row=>row.customer_id!=null&&String(row.customer_id)!==String(customerId)))fail('CUSTOMER_SCOPE_MISMATCH');
    return rows;
  }
}

function paisa(value){
  if(value==null||(typeof value!=='number'&&typeof value!=='string'))return null;
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER))return null;
  const text=String(value).trim();
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))return null;
  const negative=text.startsWith('-');
  const [whole,decimal='']=text.replace(/,/g,'').replace(/^-/,'').split('.');
  return BigInt((negative?'-':'')+whole+decimal.padEnd(2,'0'));
}
export function reconcileInvoice(cover,detail){
  if(!Array.isArray(detail))fail('BAD_RESPONSE');
  const sum=key=>{let total=0n;for(const row of detail){const v=paisa(row?.[key]);if(v===null)return null;total+=v;}return total;};
  const gross=paisa(cover?.TotalCODAmount),charge=paisa(cover?.TotalServiceCharges),net=paisa(cover?.TotalReimbursementAmount);
  const cod=sum('amount_cod'),fees=sum('amount_wr');
  const ids=detail.map(row=>String(row?.booking_id??'')).filter(Boolean);
  return {
    codMatches:gross===null||cod===null?null:gross===cod,
    chargesMatch:charge===null||fees===null?null:charge===fees,
    coverArithmeticMatches:gross===null||charge===null||net===null?null:gross-charge===net,
    taxFieldsPresent:detail.length>0&&detail.every(row=>paisa(row?.RST_Amt)!==null&&paisa(row?.RWHT_Amt)!==null),
    duplicateParcel:new Set(ids).size!==ids.length
  };
}
