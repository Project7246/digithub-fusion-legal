// Private, read-only Daewoo connection diagnostic. No app/database changes.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { Writable, PassThrough } from 'node:stream';
import { DaewooPortal, DaewooPortalError, reconcileInvoice, validateRange, chooseCustomer } from '../daewoo-portal.js';

function outcome(reply) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) ||
      typeof reply.Success !== 'boolean' || typeof reply.Error !== 'boolean') return 'UNEXPECTED_RESPONSE';
  if (!reply.Success || reply.Error) return 'REJECTED';
  if (!Array.isArray(reply.Data) || reply.Data.some(row => !row ||
      row.terminal_id == null || typeof row.terminal_name !== 'string')) return 'UNEXPECTED_RESPONSE';
  return 'PASS';
}

// Only fixed categories leave this function; never return upstream text.
function rejectionReason(reply) {
  const text=[reply?.Response,reply?.ResponseDetail].filter(v=>typeof v==='string').join(' ').toLowerCase();
  if (/rate.?limit|too many requests|throttl/.test(text)) return 'RATE_LIMIT_REPORTED';
  if (/\bip\b|whitelist|allowlist|blacklist|not allowed from/.test(text)) return 'ACCESS_POLICY_REPORTED';
  if (/disabled|suspended|deactivated|inactive account/.test(text)) return 'ACCOUNT_DISABLED_REPORTED';
  const keyMention=/api.?key|invalid key|incorrect key/.test(text);
  const credentialMention=/password|credential|invalid user|incorrect user|user.?id|unauthori[sz]|authentication|login/.test(text);
  if(keyMention && credentialMention)return 'API_CREDENTIALS_REPORTED';
  if(keyMention)return 'API_KEY_REPORTED';
  if(credentialMention)return 'CREDENTIALS_REPORTED';
  if (/required|missing|parameter|validation|invalid request/.test(text)) return 'REQUEST_VALIDATION_REPORTED';
  if (/no (?:location|terminal|data|record)/.test(text)) return 'NO_DATA_REPORTED';
  return 'UNSPECIFIED';
}

if (process.argv.includes('--self-test')) {
  const cases = [
    [{Success:true,Error:false,Data:[{terminal_id:1,terminal_name:'Fixture city'}]},'PASS'],
    [{Success:true,Error:false,Data:[]},'PASS'],
    [{Success:false,Error:true,Response:'Fixture rejection'},'REJECTED'],
    [{Success:true,Error:true,Data:[]},'REJECTED'],
    [{Success:1,Error:false,Data:[]},'UNEXPECTED_RESPONSE'],
    [{Success:true,Error:false},'UNEXPECTED_RESPONSE'],
    [{Success:true,Error:false,Data:[{other:'fixture'}]},'UNEXPECTED_RESPONSE'],
    ['<html>Fixture login</html>','UNEXPECTED_RESPONSE'],
    [null,'UNEXPECTED_RESPONSE']
  ];
  for (const [reply, expected] of cases) assert.equal(outcome(reply), expected);
  const reasons=[
    ['Invalid API Key: fixture-private','API_KEY_REPORTED'],
    ['Invalid API user or password: fixture-private','CREDENTIALS_REPORTED'],
    ['Invalid API key or password','API_CREDENTIALS_REPORTED'],
    ['Client IP not whitelisted','ACCESS_POLICY_REPORTED'],
    ['Account has been disabled','ACCOUNT_DISABLED_REPORTED'],
    ['Too many requests','RATE_LIMIT_REPORTED'],
    ['Missing parameter','REQUEST_VALIDATION_REPORTED'],
    ['No locations found','NO_DATA_REPORTED'],
    ['Unrecognized fixture-private response','UNSPECIFIED']
  ];
  for(const [Response,expected] of reasons){
    const reason=rejectionReason({Response});
    assert.equal(reason,expected);assert.ok(!reason.includes('fixture-private'));
  }
  assert.equal(rejectionReason({Response:{secret:'fixture-private'}}),'UNSPECIFIED');
  assert.equal(rejectionReason({ResponseDetail:'Invalid key fixture-private'}),'API_KEY_REPORTED');
  const stdin=new PassThrough(), stdout=new PassThrough();
  stdin.isTTY=true; stdin.setRawMode=()=>{};
  let visible=''; stdout.on('data',chunk=>{visible+=chunk;});
  const fixture='fixture-$-private';
  const answer=readHidden('Fixture input',{stdin,stdout});
  stdin.write(fixture+'\r');
  assert.equal(await answer,fixture);
  assert.ok(!visible.includes(fixture),'private input must never echo');
  assert.ok(visible.includes('Fixture input'));
  stdin.destroy();stdout.destroy();
  console.log('Daewoo checker: 9 response + 11 safe-reason + hidden-input checks PASS; no network used.');
} else {
  if(process.argv.includes('--portal'))await portalMain();
  else await main();
}

async function portalMain(){
  if(!process.stdin.isTTY){console.log('DAEWOO_PORTAL=INTERACTIVE_TERMINAL_REQUIRED');process.exitCode=1;return;}
  const argument=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
  const from=argument('--from'),to=argument('--to');
  try{validateRange(from,to);}catch{console.log('DAEWOO_PORTAL=DATE_RANGE_REQUIRED_MAX_7_DAYS');process.exitCode=1;return;}
  let userName,password,client,customers,covers,detail,choice,customerName;
  try{
    console.log('Read-only portal login and invoice check from this PC. No posting or saved credentials.');
    console.log('Use the normal Daewoo WEBSITE login here, not API Management credentials.');
    userName=await readHidden('1/2 Portal username');
    password=await readHidden('2/2 Portal password');
    client=new DaewooPortal();
    console.log('Checking portal sign-in and session...');
    await client.login(userName,password);
    userName=password=undefined;
    console.log('DAEWOO_PORTAL=PASS');
    customers=await client.customers();
    choice=chooseCustomer(customers);
    if(choice.status==='EMPTY'){console.log('DAEWOO_CUSTOMER_SCOPE=NO_CUSTOMERS');process.exitCode=1;return;}
    if(choice.status!=='SELECTED'){
      console.log('Choose your company privately. Enter its name from the website customer dropdown.');
      for(let attempt=0;attempt<5&&choice.status!=='SELECTED';attempt++){
        customerName=await readHidden('Company/customer name (or customer ID)');
        choice=chooseCustomer(customers,customerName);
        customerName=undefined;
        if(choice.status!=='SELECTED')console.log('No unique match. Use the full customer name exactly as shown on the website.');
      }
    }
    if(choice.status!=='SELECTED'){console.log('DAEWOO_CUSTOMER_SCOPE=SELECTION_REQUIRED');process.exitCode=1;return;}
    console.log('DAEWOO_CUSTOMER_SCOPE=CONFIRMED');
    console.log('Reading the selected short invoice range...');
    covers=await client.covers(from,to,choice.customer.customer_id);
    console.log('DAEWOO_CPR='+(covers.length?'READ_OK':'EMPTY_RANGE'));
    if(!covers.length)return;
    console.log('Checking one invoice detail against its cover...');
    // One cover only: verify a sample without requesting all historical parcel details.
    detail=await client.detail(covers[0].invoice_no,covers[0].customer_id);
    const match=reconcileInvoice(covers[0],detail);
    const label=value=>value===null?'UNKNOWN':value?'MATCH':'DIFFERENT';
    console.log('DAEWOO_CPR_COD='+label(match.codMatches));
    console.log('DAEWOO_CPR_CHARGES='+label(match.chargesMatch));
    console.log('DAEWOO_CPR_COVER_ARITHMETIC='+label(match.coverArithmeticMatches));
    console.log('DAEWOO_TAX_FIELDS='+(match.taxFieldsPresent?'PRESENT':'MISSING'));
    console.log('DAEWOO_DUPLICATE_PARCELS='+(match.duplicateParcel?'REVIEW':'NONE_IN_SAMPLE'));
    console.log('Only fixed diagnostic results are shown. This does not authorize financial posting.');
  }catch(error){
    console.log('DAEWOO_PORTAL='+(error instanceof DaewooPortalError?error.code:error.message==='CANCELLED'?'CANCELLED':'REQUEST_FAILED'));
    process.exitCode=1;
  }finally{
    client?.close();
    userName=password=client=customers=covers=detail=choice=customerName=undefined;
  }
}

async function readHidden(label,{stdin=process.stdin,stdout=process.stdout}={}) {
  // readline handles Windows editing/pasting, but its entire output is muted.
  // No credential is echoed, placed in shell arguments, or retained as history.
  stdout.write(label + ' (hidden; paste then Enter): ');
  const muted = new Writable({write(_chunk,_encoding,done){done();}});
  const input = createInterface({input:stdin, output:muted, terminal:true, historySize:0});
  try {
    return await new Promise((resolve,reject) => {
      input.once('SIGINT', () => reject(new Error('CANCELLED')));
      input.question('', resolve);
    });
  } finally {
    input.close();
    stdout.write('\n');
  }
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('DAEWOO_API=INTERACTIVE_TERMINAL_REQUIRED');
    process.exitCode=1; return;
  }
  let apiKey, apiUser, apiPassword, url, response, reply;
  try {
    console.log('Read-only locations API check. No booking, cancellation or payment changes.');
    console.log('This check runs on this PC, not on the Singapore app.');
    console.log('Use all three values from API Management, including its USER PASSWORD.');
    apiKey=await readHidden('1/3 API KEY');
    apiUser=await readHidden('2/3 USER ID');
    apiPassword=await readHidden('3/3 USER PASSWORD');
    if ([apiKey,apiUser,apiPassword].some(value=>!value.trim() || /^\*+$/.test(value))) {
      console.log('DAEWOO_API=INPUT_REQUIRED'); process.exitCode=1; return;
    }
    url=new URL('https://codapi.daewoo.net.pk/api/cargo/getLocations');
    url.search=new URLSearchParams({apiKey,apiUser,apiPassword}).toString();
    response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
    if (!response.ok) {
      console.log('DAEWOO_API=REQUEST_FAILED');
      console.log('HTTP_STATUS='+response.status);
      process.exitCode=1; return;
    }
    try { reply=await response.json(); }
    catch { console.log('DAEWOO_API=UNEXPECTED_RESPONSE'); process.exitCode=1; return; }
    const result=outcome(reply);
    console.log('DAEWOO_API='+result);
    if(result==='REJECTED')console.log('DAEWOO_REASON='+rejectionReason(reply));
    if (result==='PASS') {
      console.log('Locations API accepted this request. Portal login and CPR matching are separate checks.');
    } else process.exitCode=1;
  } catch (error) {
    // Upstream/network errors can echo the credential-bearing URL. Never print them.
    console.log('DAEWOO_API='+(error.message==='CANCELLED'?'CANCELLED':'REQUEST_FAILED'));
    process.exitCode=1;
  } finally {
    apiKey=apiUser=apiPassword=url=response=reply=undefined;
  }
}
