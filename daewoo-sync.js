import { openDaewooPortal } from './daewoo.js';
import { saveDaewooBundle } from './daewoo-store.js';

// One bounded portal read and one database transaction per explicit sync.
export async function syncDaewooAccount({realmId,account,from,to,credsOf,openPortal=openDaewooPortal,saveBundle=saveDaewooBundle}){
  const {client,customerId}=await openPortal(account.token,credsOf(account));
  try{
    const bundle=await client.syncBundle(from,to,customerId);
    const saved=await saveBundle({realmId,accountId:account.id,...bundle});
    return {...saved,sourceOrders:bundle.orders.length,customerId,from,to};
  }finally{client.close();}
}
