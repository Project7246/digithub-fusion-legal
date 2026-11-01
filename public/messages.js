(function(){
 'use strict';
 var banking=location.pathname.replace(/\.html$/,'')==='/banking',standalone=/^\/messages(?:\.html)?$/.test(location.pathname);
 if(!banking&&!standalone)return;
 var css=document.createElement('link');css.rel='stylesheet';css.href='/messages.css';document.head.appendChild(css);
 var people=[],threads=[],unread=[],me='',realm='',selected='',items=[],more=false,request=0,lastInput=Date.now(),lastLoad=0,drafts={},pendingSend=null;
 var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
 function api(path,body){return fetch('/api/messages/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'}).then(function(r){return r.json().then(function(d){if(!r.ok)throw Error(d.error||'Messages unavailable');return d;});});}
 var dialog=document.createElement('dialog');dialog.className='team-dialog';dialog.setAttribute('aria-label','Team messages');
 dialog.innerHTML='<header class="team-head"><h2>Team messages</h2><button class="mini" id="teamRefresh">Refresh</button><button class="mini" id="teamClose">Close</button></header><div class="team-layout"><aside class="team-people"><input id="teamSearch" placeholder="Find a colleague" aria-label="Find a colleague"><div id="teamPeople"></div></aside><section class="team-thread"><div class="team-thread-title" id="teamTitle">Choose a colleague</div><div class="team-history" id="teamHistory"></div><div class="team-status" id="teamError" role="status"></div><form class="team-compose"><textarea id="teamText" maxlength="4000" placeholder="Write a message" aria-label="Message"></textarea><button class="solid" id="teamSend" type="submit">Send</button></form></section></div>';
 document.body.appendChild(dialog);var $=function(id){return dialog.querySelector('#'+id);};
 function status(s){$('teamError').textContent=s||'';}
 function name(sub){var p=people.find(function(p){return p.sub===sub;});return p?p.name:'Colleague';}
 function count(sub){var n=unread.find(function(n){return n.sender_sub===sub;});return n?n.unread:0;}
 function peerButtons(filter){return people.filter(function(p){return !filter||p.name.toLowerCase().indexOf(filter.toLowerCase())>=0;}).map(function(p){return '<button type="button" data-peer="'+esc(p.sub)+'" class="'+(p.sub===selected?'on':'')+'">'+esc(p.name)+(count(p.sub)?' <small class="team-unread">'+count(p.sub)+'</small>':'')+'</button>';}).join('')||'<p>No colleagues available</p>';}
 function bindPeers(host){host.querySelectorAll('[data-peer]').forEach(function(b){b.onclick=function(){open(b.dataset.peer);};});}
 function paintPeople(){var host=$('teamPeople');host.innerHTML=peerButtons($('teamSearch').value);bindPeers(host);
  var rail=document.getElementById('teamRailPeople');if(rail){rail.innerHTML=peerButtons('');bindPeers(rail);}}
 function draftKey(){return 'fusion:message:'+realm+':'+me+':'+selected;}
 function keepDraft(){if(!selected)return;drafts[selected]=$('teamText').value;try{sessionStorage.setItem(draftKey(),$('teamText').value);}catch(e){}}
 function loadDraft(){var text=drafts[selected]||'';try{text=sessionStorage.getItem(draftKey())||text;}catch(e){}$('teamText').value=text;}
 function inbox(){return api('inbox').then(function(d){
  var expected=new URLSearchParams(location.search).get('company');if(standalone&&expected&&expected!==d.realm)throw Error('Switch to the message company using the company selector first.');
  people=d.people;threads=d.threads;unread=d.unread;me=d.me;realm=d.realm;lastLoad=Date.now();
  people.sort(function(a,b){var ta=threads.find(function(t){return t.peer===a.sub;}),tb=threads.find(function(t){return t.peer===b.sub;});return Number(tb&&tb.id||0)-Number(ta&&ta.id||0)||a.name.localeCompare(b.name);});paintPeople();
 });}
 function paintMessages(scroll){var host=$('teamHistory'),old=host.scrollHeight-host.scrollTop,near=host.scrollHeight-host.scrollTop-host.clientHeight<80;
  host.innerHTML=(more?'<button class="mini" id="teamOlder">Earlier messages</button>':'')+items.map(function(m){return '<article class="team-bubble '+(m.sender_sub===me?'mine':'')+'"><b>'+esc(m.sender_name)+'</b><p>'+esc(m.body)+'</p><time>'+esc(new Date(m.created_at).toLocaleString('en-GB',{timeZone:'Asia/Karachi'}))+' PKT</time></article>';}).join('');
  var earlier=$('teamOlder');if(earlier)earlier.onclick=function(){readThread(true);};
  if(scroll||near)host.scrollTop=host.scrollHeight;else host.scrollTop=host.scrollHeight-old;
 }
 function readThread(older){if(!selected)return Promise.resolve();var current=++request,peer=selected;
  return api('thread?with='+encodeURIComponent(peer)+(older&&items.length?'&before='+items[0].id:'')).then(function(d){
   if(current!==request||peer!==selected)return;
   var hadOlder=items.length>50;items=older?d.items.concat(items):Array.from(new Map(items.concat(d.items).map(function(m){return [m.id,m];})).values());
   if(older||!hadOlder)more=d.more;paintMessages(!older);status('');
   if(items.length)return api('read',{with:peer,through:items[items.length-1].id});
  }).catch(function(e){if(current===request)status(e.message);});}
 function open(peer){keepDraft();selected=peer||selected;items=[];more=false;paintPeople();$('teamTitle').textContent=selected?name(selected):'Choose a colleague';loadDraft();
  $('teamSend').disabled=!selected;if(!dialog.open)dialog.showModal();lastInput=Date.now();readThread(false);}
 $('teamSearch').oninput=paintPeople;$('teamText').oninput=function(){lastInput=Date.now();keepDraft();};
 dialog.addEventListener('click',function(){lastInput=Date.now();});
 $('teamClose').onclick=function(){keepDraft();dialog.close();};dialog.addEventListener('cancel',keepDraft);
 $('teamRefresh').onclick=function(){inbox().then(function(){return readThread(false);}).catch(function(e){status(e.message);});};
 dialog.querySelector('form').onsubmit=function(e){e.preventDefault();if(!selected)return;var text=$('teamText').value,peer=selected;if(!text.trim())return;
  if(!pendingSend||pendingSend.to!==peer||pendingSend.body!==text)pendingSend={to:peer,body:text,key:crypto.randomUUID()};
  $('teamSend').disabled=true;status('');api('send',pendingSend).then(function(){pendingSend=null;if(selected===peer&&$('teamText').value===text){$('teamText').value='';keepDraft();}return readThread(false);}).then(inbox)
   .catch(function(e){status(e.message);}).finally(function(){$('teamSend').disabled=false;});};
 window.APP.ready.then(function(s){if(!s.signedIn||!s.letIn)return;
  if(banking){var rail=document.querySelector('.rail');if(rail){var nav=rail.querySelector('nav');if(nav)nav.remove();var panel=document.createElement('section');panel.className='team-chat-rail';panel.innerHTML='<h2>Team messages</h2><p>Company conversations</p><button id="teamNew">New conversation</button><div class="team-list" id="teamRailPeople"></div>';rail.appendChild(panel);panel.querySelector('button').onclick=function(){inbox().then(function(){open('');}).catch(function(e){status(e.message);open('');});};}}
  inbox().then(function(){if(standalone)open(new URLSearchParams(location.search).get('with')||'');}).catch(function(e){if(standalone){open('');status(e.message);}else{var host=document.getElementById('teamRailPeople');if(host)host.textContent=e.message;}});
 });
 // No hidden-tab/idle polling; active open conversations refresh once a minute.
 setInterval(function(){if(dialog.open&&!document.hidden&&Date.now()-lastInput<120000){readThread(false);inbox().catch(function(){});}},60000);
 document.addEventListener('visibilitychange',function(){if(!document.hidden&&Date.now()-lastLoad>60000){lastInput=Date.now();inbox().then(function(){if(dialog.open)return readThread(false);}).catch(function(){});}});
})();
