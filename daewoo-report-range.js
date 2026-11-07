// Finite, read-only range recovery. Never return a successful partial report.
export async function readDaewooRange(from,to,read,{maxCalls=127,maxBytes=16*1024*1024,maxRows=100000}={}){
  let calls=0,bytes=0;const result=[],seen=new Map();
  const fail=code=>{const e=new Error(code);e.code=code;throw e;};
  const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  async function part(a,b){
    if(++calls>maxCalls)fail('REPORT_RANGE_TOO_LARGE');
    let rows;
    try{rows=await read(a,b);}catch(error){
      if(error.code!=='RESPONSE_TOO_LARGE')throw error;
      if(a===b)fail('SINGLE_DAY_REPORT_TOO_LARGE');
      const middle=Math.floor((Date.parse(a)+Date.parse(b))/2/86400000)*86400000;
      await part(a,new Date(middle).toISOString().slice(0,10));
      await part(new Date(middle+86400000).toISOString().slice(0,10),b);return;
    }
    // Some invoice endpoints repeat a cover across windows. Retain maximum
    // multiplicity, preserving genuine repeated rows within a source response.
    const counts=new Map();
    for(const row of rows){
      const key=canonical(row),count=(counts.get(key)||0)+1;counts.set(key,count);
      if(count<=(seen.get(key)||0))continue;
      bytes+=Buffer.byteLength(key);
      if(bytes>maxBytes||result.length>=maxRows)fail('REPORT_RANGE_TOO_LARGE');
      result.push(row);
    }
    for(const [key,count] of counts)seen.set(key,Math.max(count,seen.get(key)||0));
  }
  await part(from,to);return result;
}

export function createDaewooReportCache({now=Date.now,ttl=120000,maxBytes=16*1024*1024}={}){
  const entries=new Map(),pending=new Map();let bytes=0;
  function remove(key){const e=entries.get(key);if(e){bytes-=e.bytes;entries.delete(key);}}
  return async function get(key,load,{refresh=false}={}){
    for(const [k,e] of entries)if(e.until<=now())remove(k);
    if(!refresh&&entries.has(key))return {...entries.get(key).value,cached:true};
    if(pending.has(key))return {...await pending.get(key),cached:false};
    remove(key);
    const task=(async()=>{
      const value=await load(),size=Buffer.byteLength(JSON.stringify(value));
      if(size<=maxBytes){
        while(bytes+size>maxBytes&&entries.size)remove(entries.keys().next().value);
        entries.set(key,{value,bytes:size,until:now()+ttl});bytes+=size;
      }
      return value;
    })();
    pending.set(key,task);
    try{return {...await task,cached:false};}finally{pending.delete(key);}
  };
}
