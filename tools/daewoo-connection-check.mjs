// Private, read-only Daewoo connection diagnostic. No app/database changes.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { Writable, PassThrough } from 'node:stream';

function outcome(reply) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) ||
      typeof reply.Success !== 'boolean' || typeof reply.Error !== 'boolean') return 'UNEXPECTED_RESPONSE';
  if (!reply.Success || reply.Error) return 'REJECTED';
  if (!Array.isArray(reply.Data) || reply.Data.some(row => !row ||
      row.terminal_id == null || typeof row.terminal_name !== 'string')) return 'UNEXPECTED_RESPONSE';
  return 'PASS';
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
  console.log('Daewoo checker: 9 synthetic response checks + hidden-input check PASS; no network used.');
} else {
  await main();
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
