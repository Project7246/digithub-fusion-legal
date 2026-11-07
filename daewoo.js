import { DaewooPortal, chooseCustomer } from './daewoo-portal.js';
const fail=code=>{throw new Error('Daewoo: '+code);};

// No shared session cache: each report authenticates and validates its customer.
export async function openDaewooPortal(user,extra,Portal=DaewooPortal){
  const client=new Portal();
  try{
    await client.login(user,extra.portalPassword);
    const choice=chooseCustomer(await client.customers(),extra.customer||extra.customerId||'');
    if(choice.status!=='SELECTED')fail('CUSTOMER_SELECTION_REQUIRED');
    return {client,customerId:String(choice.customer.customer_id)};
  }catch(error){client.close();throw error;}
}

export function createDaewooAdapter({fetcher=fetch,Portal=DaewooPortal}={}){
  async function locations(extra){
    try{
      if(!extra?.apiKey||!extra.apiUser||!extra.apiPassword)fail('API_CREDENTIALS_REQUIRED');
      const url=new URL('https://codapi.daewoo.net.pk/api/cargo/getLocations');
      url.search=new URLSearchParams({apiKey:extra.apiKey,apiUser:extra.apiUser,apiPassword:extra.apiPassword});
      const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
      if(!response.ok)fail('API_REQUEST_FAILED');
      let size=0;const chunks=[];
      for await(const chunk of response.body){size+=chunk.byteLength;if(size>4*1024*1024)fail('API_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(chunk));}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(body?.Success!==true||body.Error!==false||!Array.isArray(body.Data))fail('API_REJECTED');
      if(body.Data.some(r=>r?.terminal_id==null||typeof r.terminal_name!=='string'))fail('API_RESPONSE_INVALID');
      return body.Data;
    }catch{fail('API_CONNECTION_FAILED');} // never echo credential-bearing URLs/errors
  }
  return {
    key:'daewoo',name:'Daewoo',base:'https://codapi.daewoo.net.pk',
    groupOf(status){
      const key=String(status||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
      return ({booked:'booked',delivered:'delivered','shipment delivered':'delivered',returned:'returned','rto delivered':'returned',
        'in transit':'transit','out for delivery':'transit','ready for delivery':'transit','delivery in process':'transit',
        'return in transit':'returning','out for return':'returning',cancelled:'cancelled',canceled:'cancelled',
        'on hold':'review',lost:'lost',damaged:'damaged'})[key]||'other';
    },
    lists:false,manualOnly:true,reportPath:'/daewoo',financialPosting:false,
    deducts:false, // no parcel-net calculation; deductions belong to linked invoices
    // The first field is stored as the account token in the common schema.
    // Use a non-secret portal user there; all keys/passwords go in encrypted extra.
    fields:[
      {name:'token',label:'Portal user / email',secret:false,hint:'Your normal Daewoo website login'},
      {name:'portalPassword',label:'Portal password',secret:true},
      {name:'apiKey',label:'API KEY',secret:true,hint:'API Management in the Daewoo portal'},
      {name:'apiUser',label:'API USER ID',secret:false},
      {name:'apiPassword',label:'API USER PASSWORD',secret:true},
      {name:'customer',label:'Customer name or ID',secret:false,optional:true,hint:'Required if this login has more than one customer; use the exact dropdown name'}
    ],
    async testToken(user,extra){
      await locations(extra);
      const session=await openDaewooPortal(user,extra,Portal);
      try{return {ok:true,message:'Daewoo API and portal connected. Open live reports from this account.',learned:{customerId:session.customerId}};}
      finally{session.client.close();}
    },
    async fetchAreas(_user,extra){
      return (await locations(extra)).map(row=>({id:String(row.terminal_id),name:row.terminal_name,
        hub:'',zone:'',services:[],pickup:null,delivery:null}));
    }
  };
}
export const adapter=createDaewooAdapter();
