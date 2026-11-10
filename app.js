import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $=id=>document.getElementById(id), el=(tag,cl,txt)=>{const n=document.createElement(tag);if(cl)n.className=cl;if(txt!==undefined)n.textContent=String(txt);return n;};
const CONN='serviceplanering-lab-connection-v1';
// Läs återställningsindikatorn INNAN Supabase hinner förbruka och rensa URL-fragmentet.
// Supabase kan skicka INITIAL_SESSION före PASSWORD_RECOVERY i vissa webbläsarflöden.
const recoveryLinkAtLoad=(()=>{
 try{
  const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
  const query=new URLSearchParams(window.location.search);
  return hash.get('type')==='recovery'||query.get('type')==='recovery'||query.get('auth_action')==='recovery';
 }catch{return false;}
})();
let detailYear=null,detailViewOverride=null,detailEditingCard=null;
let presenting=false,recoveryMode=recoveryLinkAtLoad,authSubscription=null;
let recoveryDetectedByEvent=false;
let sb=null, user=null, workspaces=[], workspace=null, boards=[],board=null, rows=[],columns=[],fields=[],cards=[],editingId=null,editingBoard=false,channel=null,drag=null,busy=false,focusedColumn=null;
const templateFields=()=>[{name:'Kategori',kind:'select',is_primary:true,color_source:true,options:[{label:'Alternativ A',color:'#d8eefa'},{label:'Alternativ B',color:'#d9f3dd'}]},{name:'Ansvarig',kind:'select',is_primary:true,color_source:false,options:[{label:'Jag',color:'#eeeeee'}]},{name:'Kommentar',kind:'textarea',is_primary:false,color_source:false,options:[]}];
function info(t){$('status').textContent=t;}
function feedback(id,message,isError=false){const e=$(id);e.textContent=message;e.classList.toggle('error',!!isError);}
function err(e){return e?.message||String(e);}
const formSnapshots=new Map();
function formString(dialogId){const d=$(dialogId);const inputs=[...d.querySelectorAll('input,textarea,select')].map(i=>[i.type,i.value,i.checked]);return JSON.stringify(inputs);}
function rememberForm(dialogId){formSnapshots.set(dialogId,formString(dialogId));}
function confirmAction(message,title='Bekräfta',danger=false){
 return new Promise(resolve=>{
  const d=$('confirmation-dialog');if(d.open)d.close();
  $('confirmation-title').textContent=title;
  $('confirmation-body').textContent=message;
  $('confirmation-yes').textContent=danger?'Ta bort':'Fortsätt';
  $('confirmation-yes').className=danger?'danger-solid':'primary';
  let done=false;const finish=value=>{if(done)return;done=true;d.close();resolve(value);};
  $('confirmation-cancel').onclick=()=>finish(false);
  $('confirmation-yes').onclick=()=>finish(true);
  d.oncancel=e=>{e.preventDefault();finish(false);};
  openDialogQuietly(d);
 });
}
function showMessage(message){const d=$('message-dialog');$('message-body').textContent=String(message);if(d.open)d.close();$('message-ok').onclick=()=>d.close();openDialogQuietly(d);}
window.alert=showMessage;
async function confirmDiscard(dialogId){return formSnapshots.get(dialogId)===formString(dialogId)||await confirmAction('Kasta osparade ändringar?','Osparade ändringar');}
function openDialogQuietly(dialog){
 // Välj rubriken som fokuspunkt INNAN dialogen öppnas. Annars kan Safari hinna visa tangentbordet.
 const anchor=dialog.querySelector('h2');
 if(anchor){anchor.setAttribute('tabindex','-1');anchor.setAttribute('autofocus','');}
 dialog.showModal();
 if(anchor){anchor.focus({preventScroll:true});anchor.removeAttribute('autofocus');}
}
function installFormKeys(){
 for(const form of document.querySelectorAll('dialog form')){
  form.addEventListener('keydown',e=>{
   if(e.key==='Enter' && e.target.matches('input:not([type=checkbox]):not([type=radio]),select')){
    // På iPhone avslutar Enter bara fältet – aldrig hela formuläret.
    e.preventDefault();e.stopPropagation();e.target.blur();
   }
  });
 }
}
installFormKeys();
function setupTextArea(input){
 input.classList.add('autogrow');
 const resize=()=>{input.style.height='auto';input.style.height=Math.min(Math.max(input.scrollHeight,100),Math.round(window.innerHeight*.42))+'px';};
 input.addEventListener('input',resize);
 input.addEventListener('focus',()=>{const end=input.value.length;input.setSelectionRange(end,end);resize();setTimeout(()=>input.scrollIntoView({block:'nearest',behavior:'smooth'}),180);});
 requestAnimationFrame(resize);
}
function showOnly(id){$('bottom-nav').hidden=id!=='main';for(const x of ['config','auth','main'])$(x).hidden=x!==id;}
function esc(t){return String(t||'');}
function pos(arr){return arr.length?Math.max(...arr.map(x=>x.sort_order||0))+1000:1000;}
async function req(q){const {data,error}=await q;if(error)throw error;return data;}
function call(t){if(t instanceof Error)throw t;}
function showMain(section){showOnly('main');updateBottomNav(section);for(const id of ['home','boards','board-area'])$(id).hidden=id!==section;$('button-settings').hidden=section!=='board-area';$('button-add-card').hidden=section!=='board-area';$('button-refresh').hidden=section!=='board-area';$('export-pdf').hidden=true;$('export-png').hidden=section!=='board-area';$('board-selector').hidden=section!=='board-area';$('crumb').textContent=section==='board-area'?(workspace?.name||'')+' / '+(board?.name||''):workspace?.name||'';}
function updateBottomNav(section){
 for(const id of ['nav-home','nav-boards','nav-search','nav-settings'])$(id).classList.remove('active');
 $(section==='home'?'nav-home':'nav-boards').classList.add('active');
}
$('nav-home').onclick=()=>home().catch(e=>alert(err(e)));
$('nav-boards').onclick=()=>{if(workspace)openWorkspace(workspace.id).catch(e=>alert(err(e)));else home().catch(e=>alert(err(e)));};
$('nav-search').onclick=async()=>{if(!board){showMessage('Öppna en tavla för att söka bland lappar.');return;}const term=await ask('Sök bland lappar','Skriv ett ord från rubriken eller fälten.','Söktext');if(term){const found=cards.filter(c=>[c.title,...Object.values(c.values_json||{})].join(' ').toLocaleLowerCase('sv').includes(term.toLocaleLowerCase('sv')));showMessage(found.length?found.map(c=>c.title).join('\n'):'Inga träffar.');}};
$('nav-settings').onclick=()=>{if(board)editBoard(board);else alert('Öppna en tavla för att anpassa den.');};
async function dbLoad(){return await req(sb.from('pd_workspaces').select('*').order('created_at'));}
function recentKey(){return 'planbrow-recent-v23-'+(user?.id||'guest');}
function getRecents(){try{return JSON.parse(localStorage.getItem(recentKey())||'[]');}catch{return [];}}
function markRecent(id){const ids=getRecents().filter(x=>x!==id);ids.unshift(id);localStorage.setItem(recentKey(),JSON.stringify(ids.slice(0,30)));}
async function home(){workspace=null;board=null;focusedColumn=null;if(channel){await sb.removeChannel(channel);channel=null;}workspaces=await dbLoad();showMain('home');
 const recent=$('recent-boards');recent.replaceChildren();
 try{const ids=getRecents();const all=await req(sb.from('pd_boards').select('id,name,workspace_id'));const boardItems=ids.map(id=>all.find(b=>b.id===id)).filter(Boolean).slice(0,8);
  if(!boardItems.length)recent.append(el('div','home-empty','Inga tavlor öppnade ännu. Öppna en tavla så visas den här.'));
  for(const b of boardItems){const w=workspaces.find(x=>x.id===b.workspace_id);if(!w)continue;const entry=el('button','recent-board');entry.type='button';const ic=el('span','recent-icon','▦');const txt=el('span','recent-title');txt.append(el('strong','',b.name),el('small','',w.name));entry.append(ic,txt,el('span','arrow','›'));entry.onclick=async()=>{await openWorkspace(w.id);await openBoard(b.id);};recent.append(entry);}
 }catch(e){recent.append(el('div','home-empty','Tavlorna kunde inte laddas: '+err(e)));}
 const root=$('workspaces');root.replaceChildren();if(!workspaces.length)root.append(el('p','muted','Inga arbetsytor ännu. Skapa din första!'));for(const w of workspaces){const r=el('div','workspace-item');r.append(el('strong','',w.name));const b=el('button','','Öppna →');b.onclick=()=>openWorkspace(w.id);r.append(b);root.append(r);}info(workspaces.length+' arbetsytor');}
async function ask(title,hint,placeholder='',value=''){return new Promise(resolve=>{const d=$('ask-dialog'),inp=$('ask-input');$('ask-title').textContent=title;$('ask-text').textContent=hint;inp.placeholder=placeholder;inp.value=value;let finished=false;const end=v=>{if(finished)return;finished=true;d.close();resolve(v);};$('ask-cancel').onclick=()=>end(null);$('ask-form').onsubmit=e=>{e.preventDefault();end(inp.value.trim()||null);};d.oncancel=e=>{e.preventDefault();end(null);};openDialogQuietly(d);});}
$('home-new-board').onclick=async()=>{
 if(!workspaces.length){alert('Skapa först en arbetsyta.');return;}
 if(workspaces.length===1){await openWorkspace(workspaces[0].id);editBoard(null);return;}
 const selection=await ask('Välj arbetsyta','Skriv namnet på arbetsytan för den nya tavlan.',workspaces.map(w=>w.name).join(', '));
 if(!selection)return;const w=workspaces.find(x=>x.name.toLocaleLowerCase('sv')===selection.toLocaleLowerCase('sv'));
 if(!w){alert('Hittade ingen arbetsyta med det namnet.');return;}
 await openWorkspace(w.id);editBoard(null);
};
const BUILTIN_TEMPLATES=[
 {id:'empty',name:'📝 Tom tavla',cols:[],rows:[]},
 {id:'year',name:'📅 Årsplanering (jan–dec)',cols:['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'],rows:['2027','2028','2029']},
 {id:'month',name:'🗓️ Månadsplanering (vecka 1–5)',cols:['Vecka 1','Vecka 2','Vecka 3','Vecka 4','Vecka 5'],rows:['Arbetsområde 1','Arbetsområde 2']},
 {id:'week',name:'📆 Veckoplanering',cols:['Mån','Tis','Ons','Tor','Fre','Lör','Sön'],rows:['Aktiviteter','Påminnelser']},
 {id:'service',name:'🏭 Serviceplanering (vår/höst)',cols:['🌱 Vår','🍂 Höst'],rows:['2027','2028','2029']},
 {id:'project',name:'📊 Projekt (Kanban)',cols:['Att göra','Pågår','Klart'],rows:['Projekt A','Projekt B']},
 {id:'staff',name:'👥 Personalplanering',cols:['Mån','Tis','Ons','Tor','Fre','Lör','Sön'],rows:['Lag 1','Lag 2']},
 {id:'priority',name:'🚦 Prioriteringar',cols:['Akut','Hög','Normal','Låg'],rows:['Uppgifter']},
];
function templateStorageKey(){return 'planbrow-templates-'+(user?.id||'guest');}
function savedTemplates(){try{return JSON.parse(localStorage.getItem(templateStorageKey())||'[]');}catch{return [];}}
function updateTemplatePicker(){const root=$('board-template');root.replaceChildren();for(const t of [...BUILTIN_TEMPLATES,...savedTemplates()]){const o=el('option','',t.name);o.value=t.id;root.append(o);}root.value='empty';}
function applyTemplate(id){const t=[...BUILTIN_TEMPLATES,...savedTemplates()].find(x=>x.id===id);if(!t||editingBoard)return;
 draft={rows:(t.rows||[]).map((x)=>typeof x==='string'?{label:x}:{...x}),cols:(t.cols||[]).map(x=>typeof x==='string'?{label:x}:{...x}),fields:(t.fields||[]).map(x=>({...x,options:(x.options||[]).map(v=>({...v}))}))};renderDraft();}
$('board-template').onchange=e=>applyTemplate(e.target.value);
async function saveLayoutAsTemplate(id){const b=boards.find(x=>x.id===id);if(!b)return;const name=await ask('Spara som egen mall','Bara tavlans rader, kolumner och fält sparas – inga lappar. Mallen sparas i den här webbläsaren.','Mallnamn',b.name);if(!name)return;
 try{const [rr,cc,ff]=await Promise.all(['pd_rows','pd_columns','pd_fields'].map(t=>req(sb.from(t).select('*').eq('board_id',id).order('sort_order'))));const entry={id:'custom-'+Date.now(),name:'⭐ '+name,rows:rr.map(r=>r.label),cols:cc.map(c=>c.label),fields:ff.map(f=>({name:f.name,kind:f.kind,is_primary:f.is_primary,color_source:f.color_source,options:f.options}))};const saved=savedTemplates();saved.push(entry);localStorage.setItem(templateStorageKey(),JSON.stringify(saved));info('Mall sparad i denna webbläsare ✓');}catch(e){showMessage(err(e));}}
async function renameBoard(id){const b=boards.find(x=>x.id===id);if(!b)return;const name=await ask('Byt namn på tavla','Befintliga lappar och inställningar påverkas inte.','Tavlans namn',b.name);if(!name||name===b.name)return;
 try{await req(sb.from('pd_boards').update({name}).eq('id',id));b.name=name;if(board?.id===id){board.name=name;$('current-name').textContent=name;renderSelector();}await openWorkspace(workspace.id);info('Namnet uppdaterat ✓');}catch(e){showMessage('Kunde inte byta namn: '+err(e));}}
$('new-workspace').onclick=async()=>{const name=await ask('Ny arbetsyta','Bara du ser arbetsytan tills du lägger till medlemmar.','Exempel: Familjen');if(!name)return;try{const wid=await req(sb.rpc('pd_create_workspace',{workspace_name:name}));await home();await openWorkspace(wid);}catch(e){alert(err(e));}};
async function openWorkspace(id){workspace=workspaces.find(w=>w.id===id)||null;if(!workspace){workspace=await req(sb.from('pd_workspaces').select('*').eq('id',id).single());}board=null;boards=await req(sb.from('pd_boards').select('*').eq('workspace_id',id).order('created_at'));showMain('boards');$('invite-member').hidden=workspace.created_by!==user?.id;$('manage-members').hidden=workspace.created_by!==user?.id;$('workspace-name').textContent=workspace.name;const r=$('board-list');r.replaceChildren();if(!boards.length)r.append(el('p','muted','Här finns inga tavlor ännu.'));for(const b of boards){const d=el('div','workspace-item');d.append(el('strong','',b.name));const actions=el('div','line');const open=el('button','','Öppna →');open.onclick=()=>openBoard(b.id);const menu=el('details','board-menu');const summ=el('summary','','••• Mer');summ.setAttribute('aria-label','Fler alternativ för '+b.name);const popup=el('div','board-menu-popup');
 for(const [label,fn,danger] of [['Byt namn',()=>renameBoard(b.id),false],['Duplicera',()=>duplicateBoard(b.id),false],['Spara som mall',()=>saveLayoutAsTemplate(b.id),false],['Ta bort',()=>deleteBoard(b.id),true]]){const opt=el('button',danger?'danger':'',label);opt.type='button';opt.onclick=()=>{menu.open=false;fn();};popup.append(opt);}
 menu.append(summ,popup);actions.append(open,menu);d.append(actions);r.append(d);}info(boards.length+' tavlor');}
$('go-home').onclick=()=>home().catch(e=>alert(err(e)));
$('new-board').onclick=()=>editBoard(null);
$('manage-members').onclick=()=>showMembers().catch(e=>feedback('members-feedback','Kunde inte läsa medlemmar: '+err(e),true));
$('invite-member').onclick=async()=>{if(!workspace)return;const address=await ask('Lägg till en medlem','Personen måste redan ha registrerat ett konto i appen. Du kan bara bjuda in om du äger arbetsytan.','e-postadress');if(!address)return;try{const msg=await req(sb.rpc('pd_add_member',{wid:workspace.id,member_email:address,new_role:'editor'}));alert(msg||'Klart');if($('members-dialog').open)await showMembers();}catch(e){alert(err(e));}};
async function showMembers(){if(!workspace)return;const d=$('members-dialog'),root=$('members-list');$('members-title').textContent=workspace.name;root.replaceChildren();feedback('members-feedback','Laddar…');if(!d.open)openDialogQuietly(d);const mine=workspace.created_by===user?.id;$('invite-member').hidden=!mine;const list=await req(sb.rpc('pd_list_members',{wid:workspace.id}));feedback('members-feedback',mine?'Ägaren kan ändra behörigheter och ta bort medlemmar.':'Endast arbetsytans ägare kan hantera medlemmar.');for(const m of list){const row=el('div','member-row');const left=el('div','member-info');left.append(el('strong','',m.email||'Okänd användare'),el('div','muted',m.role==='owner'?'Ägare':m.role==='editor'?'Redigerare':'Läsbehörighet'));row.append(left);if(mine&&m.role!=='owner'){const acts=el('div','member-actions');const sel=el('select');sel.setAttribute('aria-label','Behörighet för '+m.email);for(const [v,lab] of [['editor','Redigerare'],['viewer','Läsbehörighet']]){const opt=el('option','',lab);opt.value=v;sel.append(opt);}sel.value=m.role;sel.onchange=async()=>{sel.disabled=true;try{await req(sb.rpc('pd_set_member_role',{wid:workspace.id,member_id:m.user_id,new_role:sel.value}));await showMembers();}catch(e){feedback('members-feedback',err(e),true);sel.disabled=false;}};const remove=el('button','danger','Ta bort');remove.type='button';remove.onclick=async()=>{if(!await confirmAction('Ta bort '+m.email+' från arbetsytan?','Ta bort medlem',true))return;remove.disabled=true;try{await req(sb.rpc('pd_remove_member',{wid:workspace.id,member_id:m.user_id}));await showMembers();}catch(e){feedback('members-feedback',err(e),true);remove.disabled=false;}};acts.append(sel,remove);row.append(acts);}root.append(row);}if(!list.length)root.append(el('p','muted','Inga medlemmar att visa.'));}
async function openBoard(id){detailYear=null;if(presenting)endPresentation();board=boards.find(b=>b.id===id)||await req(sb.from('pd_boards').select('*').eq('id',id).single());focusedColumn=null;await reloadBoard();expanded.clear();expandAll=false;showMain('board-area');$('current-name').textContent=board.name;showDetailPanels(false);renderSelector();renderBoard();subscribe();markRecent(id);}
async function reloadBoard(){if(!board)return;const bid=board.id;const [r,c,f,n]=await Promise.all([req(sb.from('pd_rows').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_columns').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_fields').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_cards').select('*').eq('board_id',bid).order('sort_order'))]);if(board?.id!==bid)return;rows=r;columns=c;fields=f;cards=n;renderBoard();if(detailYear)renderDetailYear();info('Synkroniserat • '+n.length+' lappar');}
function renderSelector(){const s=$('board-selector');s.replaceChildren();for(const b of boards){const o=el('option','',b.name);o.value=b.id;s.append(o);}s.value=board.id;}
$('board-selector').onchange=e=>openBoard(e.target.value).catch(x=>alert(err(x)));
function accentFromPaper(color){
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return '#72889e';
 const r=parseInt(color.slice(1,3),16)/255,g=parseInt(color.slice(3,5),16)/255,b=parseInt(color.slice(5,7),16)/255;
 const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
 let hue=0;
 if(delta){switch(max){case r:hue=((g-b)/delta+6)%6;break;case g:hue=(b-r)/delta+2;break;default:hue=(r-g)/delta+4;}hue*=60;}
 if(delta<.07)return '#8497a9';
 return `hsl(${Math.round(hue)} 68% 45%)`;
}
function fieldColor(card){const f=fields.find(f=>f.color_source);if(!f)return ['#eef2f5','#8497a9'];const val=card.values_json?.[f.id];const opt=Array.isArray(f.options)?f.options.find(o=>o.label===val):null;const paper=opt?.color||'#eef2f5';return [paper,accentFromPaper(paper)];}
const expanded=new Set();
let expandAll=false, presentationMode='overview';
function isCardExpanded(id){return expandAll || expanded.has(id);}
function updateExpandControl(){
 const btn=$('expand-toggle');
 if(!btn)return;
 btn.hidden=presenting&&presentationMode==='overview';
 btn.textContent=expandAll?'⊟ Minimera alla':'⊞ Expandera alla';
 btn.setAttribute('aria-pressed',String(expandAll));
}
function presentCardDetails(card){
 const dialog=$('presentation-card-dialog'),content=$('presentation-card-details');
 content.replaceChildren();
 $('presentation-card-title').textContent=card.title;
 const rc=el('p','present-context',`${rows.find(r=>r.id===card.row_id)?.label||''} · ${columns.find(c=>c.id===card.column_id)?.label||''}`);
 content.append(rc);
 for(const f of fields){const v=card.values_json?.[f.id];if(!v)continue;
  const item=el('div','present-detail-item');item.append(el('strong','',f.name),el('div','present-detail-value',v));content.append(item);
 }
 if(!content.querySelector('.present-detail-item'))content.append(el('p','muted','Inga ytterligare detaljer.'));
 if(!dialog.open)openDialogQuietly(dialog);
}
$('expand-toggle').onclick=()=>{expandAll=!expandAll;expanded.clear();renderBoard();};
$('presentation-overview').onclick=()=>{presentationMode='overview';expandAll=false;expanded.clear();renderBoard();};
$('presentation-detail').onclick=()=>{presentationMode='detail';expandAll=false;expanded.clear();renderBoard();};

function cardElement(card,siblings,index){const n=el('article','note');n.dataset.cardId=card.id;n.tabIndex=0;n.setAttribute('role','button');n.setAttribute('aria-expanded',isCardExpanded(card.id)?'true':'false');const [paper,edge]=fieldColor(card);n.style.setProperty('--paper',paper);n.style.setProperty('--edge',edge);const top=el('div','note-labels');const primary=fields.filter(f=>f.is_primary).slice(0,2);for(const f of primary){const v=card.values_json?.[f.id];if(v)top.append(el('span','',v));}if(top.childNodes.length)n.append(top);n.append(el('div','note-name',card.title));const dt=card.values_json?._planbrow_detail;if(dt?.downtime!==undefined&&dt?.downtime!==''&&dt?.downtime!==null)n.append(el('div','note-stop','⏱ Stopptid: '+dt.downtime+' '+(dt.unit||'dagar')));const reveal=(presenting&&presentationMode==='overview')?false:isCardExpanded(card.id);if(reveal){const extra=el('div','note-extra');for(const f of fields){if(!focusedColumn&&f.is_primary)continue;const v=card.values_json?.[f.id];if(!v)continue;const pair=el('div','kv');pair.append(el('span','key',f.name),el('span','field-value',v));extra.append(pair);}const actions=el('div','note-tools');const edit=el('button','','✎ Redigera');edit.onclick=e=>{e.stopPropagation();editCard(card.id);};const up=el('button','','↑');up.title='Flytta upp';up.disabled=index===0;up.onclick=e=>{e.stopPropagation();reorderCard(card,-1);};const down=el('button','','↓');down.title='Flytta ned';down.disabled=index===siblings.length-1;down.onclick=e=>{e.stopPropagation();reorderCard(card,1);};if(!presenting){actions.append(edit,up,down);extra.append(actions);}n.append(extra);}n.onclick=e=>{
 if(suppressNextClick){e.preventDefault();return;}
 if(e.target.closest('button'))return;
 if(presenting&&presentationMode==='overview'){presentCardDetails(card);return;}
 if(expandAll){expandAll=false;expanded.clear();expanded.add(card.id);}
 else if(expanded.has(card.id))expanded.delete(card.id);
 else {expanded.clear();expanded.add(card.id);}
 renderBoard();
};n.onkeydown=e=>{if(e.key==='Enter'&&e.target===n){e.preventDefault();n.click();}};
if(!presenting)installSortableDrag(n,card);
return n;}
let suppressNextClick=false;
let sortable=null;
function installSortableDrag(node,card){
 let pressTimer=null,origin=null,started=false,originPointer=null;
 const isTouch=()=>window.matchMedia('(pointer:coarse)').matches;
 function clearTimer(){if(pressTimer!==null){clearTimeout(pressTimer);pressTimer=null;}}
 function removeListeners(){window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);window.removeEventListener('touchmove',onMove);window.removeEventListener('touchend',onUp);window.removeEventListener('touchcancel',onCancel);}
 function coordinates(e){const t=e.touches?.[0]||e.changedTouches?.[0]||e;return {x:t.clientX,y:t.clientY};}
 function start(point){
  if(!origin||sortable||presenting)return;
  started=true;clearTimer();
  const rect=node.getBoundingClientRect();
  const ghost=node.cloneNode(true);ghost.removeAttribute('tabindex');ghost.setAttribute('aria-hidden','true');ghost.classList.add('sort-floating');
  ghost.style.width=rect.width+'px';ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';
  const placeholder=el('div','sort-placeholder');placeholder.style.height=rect.height+'px';
  node.before(placeholder);node.classList.add('sort-drag-source');document.body.append(ghost);
  document.body.classList.add('sort-in-progress');
  if(window.getSelection)window.getSelection().removeAllRanges();
  sortable={id:card.id,node,ghost,placeholder,originParent:node.parentElement,originNext:node.nextSibling,deltaX:point.x-rect.left,deltaY:point.y-rect.top,last:point,validTarget:false};
  positionGhost(point);if(navigator.vibrate&&isTouch())navigator.vibrate(15);
 }
 function positionGhost(point){if(!sortable)return;const g=sortable.ghost;g.style.left=Math.max(3,Math.min(innerWidth-g.offsetWidth-3,point.x-sortable.deltaX))+'px';g.style.top=Math.max(3,Math.min(innerHeight-g.offsetHeight-3,point.y-sortable.deltaY))+'px';}
 function arrange(point){
  if(!sortable)return;
  const {placeholder}=sortable;
  const target=document.elementFromPoint(point.x,point.y);
  const cell=target?.closest('.cell');
  document.querySelectorAll('.cell.sort-target').forEach(c=>{if(c!==cell)c.classList.remove('sort-target');});
  if(!cell){sortable.validTarget=false;return;}
  sortable.validTarget=true;cell.classList.add('sort-target');
  const siblings=[...cell.querySelectorAll(':scope > .note:not(.sort-drag-source)')];
  let before=null;for(const el of siblings){const r=el.getBoundingClientRect();if(point.y<r.top+r.height/2){before=el;break;}}
  if(!before)before=cell.querySelector(':scope > .add');
  if(placeholder.parentElement===cell && placeholder.nextElementSibling===before)return;
  // Animera övriga lappar till deras nya position (FLIP), utan databasskrivning.
  const previous=new Map([...document.querySelectorAll('#board-grid .note:not(.sort-drag-source)')].map(el=>[el,el.getBoundingClientRect().top]));
  cell.insertBefore(placeholder,before||null);
  for(const [n,y] of previous){const dy=y-n.getBoundingClientRect().top;if(Math.abs(dy)<1)continue;
   n.style.transition='none';n.style.transform=`translateY(${dy}px)`;
   n.getBoundingClientRect();n.style.transition='transform 155ms ease';n.style.transform='';
  }
 }
 function onMove(e){if(!origin)return;const pt=coordinates(e);if(!started){
   if(originPointer==='touch'){if(Math.hypot(pt.x-origin.x,pt.y-origin.y)>9){clearTimer();origin=null;removeListeners();}return;}
   if(Math.hypot(pt.x-origin.x,pt.y-origin.y)<7)return;
   start(pt);
  }
  if(!sortable||sortable.id!==card.id)return;
  if(e.cancelable)e.preventDefault();
  sortable.last=pt;positionGhost(pt);arrange(pt);
 }
 function finish(cancel=false){clearTimer();removeListeners();origin=null;started=false;if(!sortable||sortable.id!==card.id)return;
  const {node,ghost,placeholder,id,originParent,originNext,validTarget}=sortable;
  const cell=(!cancel&&validTarget)?placeholder.closest('.cell'):null;
  // Identifiera närmast efterföljande lapp i den nya visuella ordningen.
  let next=placeholder.nextElementSibling;while(next&&!next.matches('.note:not(.sort-drag-source)'))next=next.nextElementSibling;
  const nextId=next?.dataset.cardId||null;
  if(cell){cell.insertBefore(node,placeholder);}else{originParent.insertBefore(node,originNext?.parentNode===originParent?originNext:null);}
  placeholder.remove();ghost.remove();node.classList.remove('sort-drag-source');
  document.querySelectorAll('.cell.sort-target').forEach(c=>c.classList.remove('sort-target'));
  document.body.classList.remove('sort-in-progress');sortable=null;
  suppressNextClick=true;setTimeout(()=>suppressNextClick=false,450);
  if(cell){moveCard(id,cell.dataset.row,cell.dataset.column,nextId).catch(e=>showMessage(err(e)));}
 }
 function onUp(){if(started)finish();else{clearTimer();removeListeners();origin=null;}}
 function onCancel(){finish(true);}
 node.addEventListener('contextmenu',e=>{if(originPointer==='touch'||sortable)e.preventDefault();});
 node.addEventListener('selectstart',e=>{if(sortable)e.preventDefault();});
 node.addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('button,input,select,textarea')||presenting||busy)return;
  if(sortable)return;origin=coordinates(e);originPointer='mouse';window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);
 });
 node.addEventListener('touchstart',e=>{if(e.touches.length!==1||e.target.closest('button,input,select,textarea')||presenting||busy||sortable)return;
  origin=coordinates(e);originPointer='touch';clearTimer();pressTimer=setTimeout(()=>{if(origin)start(origin);},420);
  window.addEventListener('touchmove',onMove,{passive:false});window.addEventListener('touchend',onUp,{passive:true});window.addEventListener('touchcancel',onCancel,{passive:true});
 },{passive:true});
}
function renderBoard(){if(!board||!$('board-grid'))return;
 const heading=$('presentation-heading');heading.hidden=!presenting;
 $('presentation-heading-title').textContent=board.name||'Namnlös tavla';
 const subtitle=(board.subtitle||'').trim();$('presentation-heading-subtitle').textContent=subtitle;$('presentation-heading-subtitle').hidden=!subtitle;
 updateExpandControl();
 $('presentation-overview').classList.toggle('active',presenting&&presentationMode==='overview');
 $('presentation-detail').classList.toggle('active',presenting&&presentationMode==='detail');
 document.body.classList.toggle('present-detail',presenting&&presentationMode==='detail');
 document.body.classList.toggle('present-overview',presenting&&presentationMode==='overview');const cols=focusedColumn?columns.filter(c=>c.id===focusedColumn):columns;const root=$('board-grid'),outer=$('board');outer.classList.toggle('focus',Boolean(focusedColumn));root.style.setProperty('--cols',String(Math.max(1,cols.length)));
 // Presentationslägets rader ska följa innehållets naturliga höjd.
 // Ingen beräknad kort- eller radhöjd: luft mellan korten utan utdragna tomrum.
 root.style.gridTemplateRows='';
 root.replaceChildren();if(!rows.length||!columns.length){const empty=el('div','empty','Den här tavlan är tom. Öppna Tavlans inställningar och lägg till minst en rad och en kolumn för att börja.');root.append(empty);$('button-add-card').disabled=true;$('view-all').hidden=true;$('view-label').textContent='Tom tavla';return;}$('button-add-card').disabled=false;if(!presenting)root.append(el('div','corner'));for(const c of cols){const h=el('div','col-head',c.label);h.title='Visa denna kolumn större';h.onclick=()=>{if(window.matchMedia('(max-width:650px)').matches&&!focusedColumn){focusedColumn=c.id;renderBoard();}};root.append(h);}for(const r of rows){if(presenting){const divider=el('div','row-section-divider',r.label);root.append(divider);}const rowIndex=rows.indexOf(r);const band=rowIndex%2?'section-alt':'section-main';if(!presenting){const rh=el('div','row-head '+band);if(/^20\d{2}$/.test(r.label.trim())&&board.detail_settings?.enabled){const go=el('button','year-heading-button',r.label+' ↗');go.type='button';go.title='Öppna detaljplanering för '+r.label;go.onclick=()=>openDetailYear(r.id);rh.append(go);}else rh.textContent=r.label;root.append(rh);}for(const c of cols){const zone=el('section','cell '+band);zone.dataset.row=r.id;zone.dataset.column=c.id;const arr=cards.filter(x=>x.row_id===r.id&&x.column_id===c.id).sort((a,b)=>a.sort_order-b.sort_order);for(let i=0;i<arr.length;i++)zone.append(cardElement(arr[i],arr,i));if(!presenting){const add=el('button','add','＋');add.title='Lägg till här';add.onclick=()=>editCard(null,r.id,c.id);zone.append(add);}root.append(zone);}}$('view-all').hidden=!focusedColumn;$('view-label').textContent=focusedColumn?(columns.find(c=>c.id===focusedColumn)?.label||'Kolumn'):'Tryck på en kolumnrubrik för större vy';}
$('view-all').onclick=()=>{focusedColumn=null;renderBoard();};
function endPresentation(){if(!presenting)return;presenting=false;presentationMode='overview';expandAll=false;expanded.clear();$('presentation-card-dialog').close();document.body.classList.remove('presenting');$('end-presentation').hidden=true;$('start-presentation').hidden=false;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});renderBoard();}

/* ---------------- PDF export 2.5.1 ----------------
 * Endast redan inlästa tavledata används. Ingen data skickas till exporttjänst.
 * PDFMake laddas från jsDelivr, men själva dokumentet byggs lokalt i webbläsaren.
 * 1 cell per kolumn och tabellrad för att kunna bryta sida utan att skära i lappar.
 */
const PDFMAKE_VERSION='0.2.20';
let pdfLibPromise=null;
// pdfmake 0.2.x stores embedded fonts through addVirtualFileSystem().
// It does NOT reliably expose them through window.pdfMake.vfs.
// Do not reject a functioning PDF engine simply because .vfs is absent.
function loadPDFLibrary(){
 if(pdfLibPromise)return pdfLibPromise;
 const hasEngine=()=>typeof window.pdfMake?.createPdf==='function';
 function loadScript(src){return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  let settled=false;
  const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);script.onload=null;script.onerror=null;if(error){script.remove();reject(error);}else resolve();};
  const timer=setTimeout(()=>finish(Error('Tidsgräns för laddning av PDF-biblioteket.')),15000);
  script.src=src;script.async=true;
  script.onload=()=>finish();
  script.onerror=()=>finish(Error('Kunde inte ladda '+src.split('/').pop()+'.'));
  document.head.append(script);
 });}
 async function loadWithFallback(filename){
  const sources=[
   'https://cdn.jsdelivr.net/npm/pdfmake@'+PDFMAKE_VERSION+'/build/'+filename,
   'https://unpkg.com/pdfmake@'+PDFMAKE_VERSION+'/build/'+filename
  ];
  let lastError;
  for(const url of sources){
   try{await loadScript(url);return;}catch(error){lastError=error;}
  }
  throw Error('PDF-biblioteket kunde inte laddas. Kontrollera nätverket eller om CDN blockeras. '+(lastError?.message||''));
 }
 pdfLibPromise=(async()=>{
  if(!hasEngine())await loadWithFallback('pdfmake.min.js');
  if(!hasEngine())throw Error('PDF-motorn kunde inte starta.');
  // vfs_fonts.js registers Roboto via pdfMake.addVirtualFileSystem() in 0.2.x.
  // It is safe to load even when .vfs is undefined.
  await loadWithFallback('vfs_fonts.js');
  return window.pdfMake;
 })().catch(error=>{pdfLibPromise=null;throw error;});
 return pdfLibPromise;
}
function pdfText(value){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();}
function pdfSafeName(name){return pdfText(name).replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,'_').slice(0,70)||'PlanBroW';}
function pdfMakeCard(card,options,baseFont){
 const printMode=options.theme==='print';
 const [paper,accent]=fieldColor(card);
 const primary=fields.filter(f=>f.is_primary).slice(0,2);
 const lines=[];
 const primaryValues=primary.map(f=>pdfText(card.values_json?.[f.id])).filter(Boolean);
 if(primaryValues.length)lines.push({text:primaryValues.join('  ·  '),fontSize:Math.max(7,baseFont-2),color:printMode?'#556476':'#48617e',margin:[0,0,0,4]});
 lines.push({text:pdfText(card.title)||'Namnlös lapp',bold:true,fontSize:baseFont,color:'#172e4a'});
 if(options.content!=='overview'){
  for(const f of fields){
   if(options.content==='detail'&&f.is_primary)continue;
   const value=pdfText(card.values_json?.[f.id]);if(!value)continue;
   lines.push({text:[{text:pdfText(f.name)+': ',bold:true},value],fontSize:Math.max(7,baseFont-1),color:'#40536b',margin:[0,5,0,0],preserveLeadingSpaces:false});
  }
 }
 return {stack:lines,fillColor:printMode?'#f8f9fb':paper,margin:[9,8,9,9],border:[false,false,false,false]};
}
function pdfBoardDefinition(options){
 if(!board)throw Error('Öppna en tavla först.');
 if(!columns.length||!rows.length)throw Error('Tavlan behöver minst en rad och en kolumn för export.');
 const printMode=options.theme==='print';
 const maxColumns=options.fit?columns.length:(options.paper==='A4'?3:options.paper==='A3'?5:7);
 const groups=[];
 for(let offset=0;offset<columns.length;offset+=maxColumns)groups.push(columns.slice(offset,offset+maxColumns));
 const fs=columns.length>6&&options.fit?8:columns.length>4&&options.fit?9:11;
 const content=[];
 content.push({text:pdfText(board.name)||'Planering',style:'docTitle',alignment:'center',margin:[0,0,0,5]});
 if(options.subtitle&&pdfText(board.subtitle))content.push({text:pdfText(board.subtitle),fontSize:11,color:'#657b93',alignment:'center',margin:[0,0,0,7]});
 if(options.date)content.push({text:'Exporterad '+new Intl.DateTimeFormat('sv-SE',{dateStyle:'medium',timeStyle:'short'}).format(new Date()),fontSize:9,color:'#657b93',alignment:'center',margin:[0,0,0,9]});
 const paperDims={A4:[595,842],A3:[842,1191],A2:[1191,1684]};
 const longSide=paperDims[options.paper][1],shortSide=paperDims[options.paper][0];
 const pageWidth=options.orientation==='landscape'?longSide:shortSide;
 content.push({canvas:[{type:'line',x1:0,y1:0,x2:pageWidth-56,y2:0,lineWidth:2,lineColor:printMode?'#c4cdd8':'#e98b31'}],margin:[0,0,0,14]});
 let hasAnyCard=false;
 for(const r of rows){
  for(let gi=0;gi<groups.length;gi++){
   const group=groups[gi];
   const byColumn=group.map(c=>cards.filter(x=>x.row_id===r.id&&x.column_id===c.id).sort((a,b)=>a.sort_order-b.sort_order));
   const longest=Math.max(0,...byColumn.map(a=>a.length));
   if(longest)hasAnyCard=true;
   content.push({text:pdfText(r.label)+(groups.length>1?' · Del '+(gi+1)+'/'+groups.length:''),style:'rowTitle',margin:[0,14,0,7]});
   const cells=[group.map(c=>({text:pdfText(c.label),bold:true,fontSize:Math.max(9,fs),fillColor:printMode?'#e8edf2':'#e5eef7',color:'#203c5b',margin:[7,7,7,7],alignment:'center'}))];
   if(!longest){cells.push(group.map(()=>({text:'',fillColor:'#ffffff',margin:[0,8,0,8]})));}
   for(let i=0;i<longest;i++){
    cells.push(group.map((c,j)=>byColumn[j][i]?pdfMakeCard(byColumn[j][i],options,fs):{text:'',fillColor:'#ffffff'}));
   }
   content.push({table:{headerRows:1,dontBreakRows:true,keepWithHeaderRows:1,widths:group.map(()=>'*'),body:cells},
     layout:{hLineWidth:()=>0,vLineWidth:()=>0,paddingLeft:()=>5,paddingRight:()=>5,paddingTop:()=>5,paddingBottom:()=>5},
     margin:[0,0,0,5]});
  }
 }
 if(!hasAnyCard)content.push({text:'Inga lappar på tavlan.',italics:true,color:'#657b93',margin:[0,12,0,0]});
 return {
  pageSize:options.paper,
  pageOrientation:options.orientation,
  pageMargins:[28,32,28,36],
  defaultStyle:{font:'Roboto',fontSize:fs,color:'#17314e'},
  styles:{docTitle:{fontSize:Math.max(18,fs+10),bold:true,color:'#173555'},rowTitle:{fontSize:Math.max(12,fs+3),bold:true,color:'#213e5d'}},
  footer:(current,total)=>({text:`PlanBroW  •  ${current} / ${total}`,fontSize:8,color:'#7b8a9a',alignment:'right',margin:[0,0,30,0]}),
  content,
  info:{title:pdfText(board.name)||'PlanBroW',subject:'Exporterad planering från PlanBroW',creator:'PlanBroW 2.5.1'}
 };
}
$('export-pdf').onclick=()=>{
 if(!board){showMessage('Öppna en tavla för att exportera PDF.');return;}
 feedback('pdf-feedback','');
 openDialogQuietly($('pdf-export-dialog'));
};
$('pdf-cancel').onclick=()=>$('pdf-export-dialog').close();
$('pdf-export-form').onsubmit=async e=>{
 e.preventDefault();
 if(!board)return;
 const submit=$('pdf-submit');submit.disabled=true;
 feedback('pdf-feedback','Förbereder PDF…');
 const options={
  paper:$('pdf-paper').value,orientation:$('pdf-orientation').value,
  content:$('pdf-content').value,theme:$('pdf-theme').value,
  date:$('pdf-date').checked,subtitle:$('pdf-subtitle').checked,fit:$('pdf-fit').checked
 };
 try{
  const pdfMake=await loadPDFLibrary();
  feedback('pdf-feedback','Skapar PDF…');
  const definition=pdfBoardDefinition(options);
  const filename=pdfSafeName(board.name)+'_'+new Date().toISOString().slice(0,10)+'.pdf';
  await new Promise((resolve,reject)=>{
   try{pdfMake.createPdf(definition).getBlob(blob=>{
     try{
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=filename;
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      resolve();
     }catch(e){reject(e);}
   });}catch(e){reject(e);}
  });
  $('pdf-export-dialog').close();info('PDF skapad ✓');
 }catch(e){feedback('pdf-feedback','Kunde inte exportera: '+err(e),true);}
 finally{submit.disabled=false;}
};
/* ---------------- End PDF export ---------------- */
/* ---------------- PNG export 2.5.2 ----------------
 * Exporterar riktiga DOM-kort från presentationsläget (ingen omritad tabell).
 * html2canvas laddas endast när det behövs; tavledata skickas inte till någon tjänst.
 */
let pngLibraryPromise=null;
function loadPNGEngine(){
 if(window.html2canvas)return Promise.resolve(window.html2canvas);
 if(pngLibraryPromise)return pngLibraryPromise;
 const sources=[
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
 ];
 pngLibraryPromise=(async()=>{
  let last;
  for(const url of sources){
   try{
    await new Promise((resolve,reject)=>{
     const script=document.createElement('script');script.src=url;script.async=true;
     const timer=setTimeout(()=>{script.remove();reject(Error('Laddningen tog för lång tid.'));},15000);
     script.onload=()=>{clearTimeout(timer);resolve();};
     script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('Kunde inte ladda bildbiblioteket.'));};
     document.head.append(script);
    });
    if(typeof window.html2canvas==='function')return window.html2canvas;
   }catch(e){last=e;}
  }
  throw Error('Bildbiblioteket kunde inte laddas. Kontrollera internetanslutningen. '+(last?.message||''));
 })().catch(e=>{pngLibraryPromise=null;throw e;});
 return pngLibraryPromise;
}
function pngDownload(canvas,name){
 return new Promise((resolve,reject)=>{
  try{
   if(!canvas.toBlob)throw Error('Din webbläsare stöder inte PNG-export här.');
   canvas.toBlob(blob=>{
    if(!blob){reject(Error('Kunde inte skapa bildfilen.'));return;}
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    resolve();
   },'image/png');
  }catch(e){reject(e);}
 });
}
$('export-png').onclick=()=>{
 if(!board){showMessage('Öppna en tavla innan du exporterar.');return;}
 feedback('png-feedback','');openDialogQuietly($('png-export-dialog'));
};
$('png-cancel').onclick=()=>$('png-export-dialog').close();
$('png-export-form').onsubmit=async e=>{
 e.preventDefault();
 if(!board||!rows.length||!columns.length){feedback('png-feedback','Tavlan måste ha minst en rad och en kolumn.',true);return;}
 const button=$('png-submit');button.disabled=true;
 let holder=null;
 const old={presenting,presentationMode,expandAll,focusedColumn,expanded:new Set(expanded)};
 try{
  feedback('png-feedback','Förbereder presentationsvyn…');
  const capture=await loadPNGEngine();
  // Använd verklig presentations-rendering och återställ användarens vy efteråt.
  presenting=true;presentationMode='overview';expandAll=false;focusedColumn=null;expanded.clear();
  document.body.classList.add('presenting');renderBoard();
  holder=el('div');holder.id='png-capture-host';holder.setAttribute('aria-hidden','true');
  holder.append($('presentation-heading').cloneNode(true),$('board').cloneNode(true));
  document.body.append(holder);
  const width=1300;
  const originalHeight=Math.ceil(holder.scrollHeight);
  const requested=Number($('png-scale').value)||3;
  // Safaris canvas/gräns för minne är extra känslig på mobil.
  const mobile=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  const maxPixels=mobile?12000000:32000000;
  const scale=Math.min(requested,Math.sqrt(maxPixels/(width*originalHeight)));
  const canvasW=Math.ceil(width*scale),canvasH=Math.ceil(originalHeight*scale);
  if(originalHeight>25000||scale<0.7||canvasW>16000||canvasH>16000){
   throw Error('Tavlan är för stor för en enda bild i den här webbläsaren. Prova på dator eller minska tavlans innehåll.');
  }
  feedback('png-feedback',`Skapar bild (${canvasW} × ${canvasH} pixlar)…`);
  const canvas=await capture(holder,{
   backgroundColor:'#f5f7fb',scale,
   width,height:originalHeight,windowWidth:1500,windowHeight:Math.max(900,originalHeight),
   scrollX:0,scrollY:0,useCORS:true,logging:false,
   onclone:doc=>{
    doc.body.classList.add('presenting','present-overview');
    doc.body.classList.remove('present-detail');
    const target=doc.getElementById('png-capture-host');
    if(target){target.style.left='0px';target.style.top='0px';target.style.position='absolute';target.style.width='1300px';}
   }
  });
  await pngDownload(canvas,pdfSafeName(board.name)+'_'+new Date().toISOString().slice(0,10)+'.png');
  $('png-export-dialog').close();info('PNG exporterad ✓');
 }catch(error){feedback('png-feedback','Kunde inte exportera: '+err(error),true);}
 finally{
  if(holder)holder.remove();
  presenting=old.presenting;presentationMode=old.presentationMode;expandAll=old.expandAll;focusedColumn=old.focusedColumn;
  expanded.clear();for(const id of old.expanded)expanded.add(id);
  document.body.classList.toggle('presenting',presenting);renderBoard();
  button.disabled=false;
 }
};
/* ---------------- End PNG export ---------------- */


$('start-presentation').onclick=async()=>{if(!board)return;presenting=true;presentationMode='overview';expandAll=false;expanded.clear();focusedColumn=null;document.body.classList.add('presenting');$('start-presentation').hidden=true;$('end-presentation').hidden=false;renderBoard();const area=$('board-area');if(area.requestFullscreen){try{await area.requestFullscreen();}catch{/* iPhone Safari: visningsläge utan native fullscreen */}}};
$('end-presentation').onclick=endPresentation;
document.addEventListener('fullscreenchange',()=>{if(presenting&&!document.fullscreenElement)endPresentation();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&presenting)endPresentation();});
async function mutation(action){if(busy)return;busy=true;try{await action();await reloadBoard();info('Sparat ✓');}catch(e){alert('Kunde inte spara: '+err(e));await reloadBoard().catch(()=>{});}finally{busy=false;}}
async function moveCard(id,rid,cid,beforeId){
 const card=cards.find(c=>c.id===id);if(!card||busy)return;
 const arr=cards.filter(c=>c.row_id===rid&&c.column_id===cid&&c.id!==id).sort((a,b)=>a.sort_order-b.sort_order);
 let at=beforeId?arr.findIndex(c=>c.id===beforeId):arr.length;if(at<0)at=arr.length;
 // Hoppa över databasskrivning om platsen inte har förändrats.
 const initial=cards.filter(c=>c.row_id===card.row_id&&c.column_id===card.column_id).sort((a,b)=>a.sort_order-b.sort_order);
 const same=card.row_id===rid&&card.column_id===cid;
 if(same&&initial.findIndex(x=>x.id===id)===at)return;
 const lo=at>0?arr[at-1].sort_order:null,hi=at<arr.length?arr[at].sort_order:null;
 const order=lo==null?(hi==null?1000:hi-1000):(hi==null?lo+1000:Math.floor((hi+lo)/2));
 const needsRebalance=lo!=null&&hi!=null&&hi-lo<2;
 await mutation(async()=>{
  if(needsRebalance){
   // Sorteringsvärden kan ta slut efter många flyttar. Numrera om utan att tappa ordningen.
   const sorted=[...arr];sorted.splice(at,0,card);
   for(let i=0;i<sorted.length;i++){
    const x=sorted[i],change={sort_order:(i+1)*1000};
    if(x.id===id){change.row_id=rid;change.column_id=cid;}
    const data=await req(sb.from('pd_cards').update(change).eq('id',x.id).eq('updated_at',x.updated_at).select('id'));
    if(!data.length)throw Error('En annan användare hann ändra tavlan. Uppdatera och försök igen.');
   }
  }else{
   const data=await req(sb.from('pd_cards').update({row_id:rid,column_id:cid,sort_order:order}).eq('id',id).eq('updated_at',card.updated_at).select('id'));
   if(!data.length)throw Error('En annan användare hann ändra lappen.');
  }
 });
}

function reorderCard(c,dir){const arr=cards.filter(x=>x.row_id===c.row_id&&x.column_id===c.column_id).sort((a,b)=>a.sort_order-b.sort_order);const i=arr.findIndex(x=>x.id===c.id);if(dir<0&&i>0)moveCard(c.id,c.row_id,c.column_id,arr[i-1].id);else if(dir>0&&i<arr.length-1)moveCard(c.id,c.row_id,c.column_id,arr[i+1+1]?.id);}
function fillSelect(select,list,selected){select.replaceChildren();for(const x of list){const opt=el('option','',x.label);opt.value=x.id;select.append(opt);}if(selected)select.value=selected;}
function editCard(id,rid,cid){if(!rows.length||!columns.length){alert('Lägg först till minst en rad och en kolumn i tavlans inställningar.');return;}const card=cards.find(c=>c.id===id);editingId=id;const rr=$('card-row'),cc=$('card-column');fillSelect(rr,rows,card?.row_id||rid||rows[0]?.id);fillSelect(cc,columns,card?.column_id||cid||columns[0]?.id);$('card-title').value=card?.title||'';$('card-dialog-title').textContent=card?'Visa / redigera lapp':'Ny lapp';$('card-delete').hidden=!card;const target=$('card-fields');target.replaceChildren();for(const f of fields){const label=el('label','control');label.append(el('span','',f.name));let input;if(f.kind==='select'){input=el('select');const blank=el('option','','Ej vald');blank.value='';input.append(blank);for(const o of f.options||[]){const n=el('option','',o.label);n.value=o.label;input.append(n);}}else{input=el(f.kind==='textarea'?'textarea':'input');if(f.kind!=='textarea')input.type='text';input.maxLength=1000;}input.dataset.fieldId=f.id;input.value=card?.values_json?.[f.id]||'';if(f.kind==='textarea')setupTextArea(input);label.append(input);target.append(label);}openDialogQuietly($('card-dialog'));rememberForm('card-dialog');}
$('button-add-card').onclick=()=>editCard(null);
$('card-dialog').addEventListener('cancel',e=>{e.preventDefault();confirmDiscard('card-dialog').then(ok=>{if(ok)$('card-dialog').close();});});
$('card-cancel').onclick=async()=>{if(await confirmDiscard('card-dialog'))$('card-dialog').close();};
$('card-form').onsubmit=async e=>{e.preventDefault();if(!e.submitter||e.submitter.tagName!=='BUTTON')return;const title=$('card-title').value.trim();if(!title)return;const old=cards.find(c=>c.id===editingId);const vals={...(old?.values_json||{})};for(const x of $('card-fields').querySelectorAll('[data-field-id]'))vals[x.dataset.fieldId]=x.value.trim();const input={board_id:board.id,row_id:$('card-row').value,column_id:$('card-column').value,title,values_json:vals,sort_order:old?.sort_order??pos(cards.filter(c=>c.row_id===$('card-row').value&&c.column_id===$('card-column').value))};$('card-dialog').close();await mutation(async()=>{if(old){const data=await req(sb.from('pd_cards').update(input).eq('id',old.id).eq('updated_at',old.updated_at).select('id'));if(!data.length)throw Error('Lappen ändrades samtidigt av någon annan.');}else await req(sb.from('pd_cards').insert(input));});};
$('card-delete').onclick=async()=>{const old=cards.find(c=>c.id===editingId);if(!old||!await confirmAction('Vill du verkligen ta bort lappen ”'+old.title+'”? Detta går inte att ångra.','Ta bort lapp?',true))return;$('card-dialog').close();await mutation(async()=>{await req(sb.from('pd_cards').delete().eq('id',old.id));});};
$('button-refresh').onclick=()=>reloadBoard().catch(e=>alert(err(e)));
function subscribe(){if(channel)sb.removeChannel(channel);channel=sb.channel('pd-'+board.id).on('postgres_changes',{event:'*',schema:'public',table:'pd_cards',filter:'board_id=eq.'+board.id},()=>{if(!$('card-dialog').open&&!busy)reloadBoard().catch(()=>{});else info('En annan användare har ändrat tavlan – uppdatera efter redigering');}).subscribe();}
// Redigerare för antal rader, kolumner och fält; arbetar först i lokalt formulär.
let draft=null;
function labelEditor(container,items,limit){const root=$(container);root.replaceChildren();items.forEach((item,i)=>{const div=el('div','item-head');const inp=el('input');inp.value=item.label;inp.placeholder='Ange namn';inp.setAttribute('aria-label','Namn');inp.oninput=()=>{item.label=inp.value;};const rem=el('button','','×');rem.type='button';rem.disabled=false;rem.onclick=async()=>{if(!await confirmAction('Ta bort raden/kolumnen? Innehåll måste först flyttas bort.','Ta bort?',true))return;items.splice(i,1);renderDraft();};div.append(inp,rem);root.append(div);});}
function renderDraft(){labelEditor('rows-editor',draft.rows,20);labelEditor('columns-editor',draft.cols,12);const root=$('fields-editor');root.replaceChildren();draft.fields.forEach((f,i)=>{const item=el('div','item');const line=el('div','item-head');const inp=el('input');inp.value=f.name;inp.placeholder='Ange fältnamn';inp.setAttribute('aria-label','Fältnamn');inp.oninput=()=>f.name=inp.value;const del=el('button','','×');del.type='button';del.onclick=async()=>{if(!await confirmAction('Ta bort fältet? Fält med sparad information kan inte tas bort.','Ta bort fält?',true))return;draft.fields.splice(i,1);renderDraft();};line.append(inp,del);item.append(line);const type=el('select');for(const [v,name] of [['text','Text'],['textarea','Lång text'],['select','Rullista']]){const op=el('option','',name);op.value=v;type.append(op);}type.value=f.kind;type.onchange=()=>{f.kind=type.value;renderDraft();};const typeLine=el('label','control');typeLine.append(el('span','','Typ'),type);item.append(typeLine);const p=el('label','mini');const check=el('input');check.type='checkbox';check.checked=!!f.is_primary;check.onchange=()=>{if(check.checked&&draft.fields.filter(x=>x.is_primary).length>=2){check.checked=false;alert('Max två extra primära fält. Rubriken är alltid synlig.');return;}f.is_primary=check.checked;};p.append(check,document.createTextNode(' Primärt fält (synligt på lappen)'));item.append(p);const color=el('label','mini');const c=el('input');c.type='radio';c.name='colorfield';c.checked=!!f.color_source;c.onchange=()=>{draft.fields.forEach(x=>x.color_source=x===f);};color.append(c,document.createTextNode(' Styr lappens färg'));item.append(color);
if(f.kind==='select'){const list=el('div','settings-list');for(let j=0;j<(f.options||[]).length;j++){const opt=f.options[j];const row=el('div','item-head');const name=el('input');name.value=opt.label;name.placeholder='Alternativ';name.oninput=()=>opt.label=name.value;const swatch=el('input');swatch.type='color';swatch.className='swatch';swatch.value=/^#[0-9a-f]{6}$/i.test(opt.color)?opt.color:'#d8eefa';swatch.title='Alternativets färg';swatch.oninput=()=>opt.color=swatch.value;const remove=el('button','','×');remove.type='button';remove.onclick=()=>{f.options.splice(j,1);renderDraft();};row.append(name,swatch,remove);list.append(row);}const add=el('button','','＋ Alternativ');add.type='button';add.onclick=()=>{f.options.push({label:'Nytt alternativ',color:'#dde6ef',_originalLabel:null});renderDraft();};item.append(list,add);}root.append(item);});}
$('add-row').onclick=()=>{if(draft.rows.length>=20)return;draft.rows.push({label:''});renderDraft();$('rows-editor').lastElementChild?.querySelector('input')?.focus();};
$('add-column').onclick=()=>{if(draft.cols.length>=12)return;draft.cols.push({label:''});renderDraft();$('columns-editor').lastElementChild?.querySelector('input')?.focus();};
$('add-field').onclick=()=>{if(draft.fields.length>=20)return;draft.fields.push({name:'',kind:'text',is_primary:false,color_source:false,options:[]});renderDraft();$('fields-editor').lastElementChild?.querySelector('input')?.focus();};
$('board-dialog').addEventListener('cancel',e=>{e.preventDefault();confirmDiscard('board-dialog').then(ok=>{if(ok)$('board-dialog').close();});});
$('board-cancel').onclick=async()=>{if(await confirmDiscard('board-dialog'))$('board-dialog').close();};
$('button-settings').onclick=()=>editBoard(board);
function editBoard(b){editingBoard=Boolean(b);draft={rows:b?rows.map(x=>({...x})):[],cols:b?columns.map(x=>({...x})):[],fields:b?fields.map(x=>({...x,options:(x.options||[]).map(o=>({...o,_originalLabel:o.label}))})):[]};$('board-name').value=b?.name||'';$('board-subtitle').value=b?.subtitle||'';$('board-dialog-title').textContent=b?'Anpassa tavla':'Skapa tavla';$('board-template-section').hidden=!!b;const ds=b?.detail_settings||{};$('board-detail-enabled').checked=!!ds.enabled;const defs={...DETAIL_DEFAULTS,...(ds.defaults||{})};$('detail-default-view').value=defs.view;$('detail-default-scale').value=defs.scale;periodEditor('board-periods-editor',periodsFromSettings(defs));if(!b)updateTemplatePicker();$('board-detail-enabled').onchange();renderDraft();openDialogQuietly($('board-dialog'));rememberForm('board-dialog');}
$('board-form').onsubmit=async e=>{e.preventDefault();if(!e.submitter||e.submitter.tagName!=='BUTTON')return;if(busy)return;const name=$('board-name').value.trim();const subtitle=$('board-subtitle').value.trim();if(!name)return;if($('board-detail-enabled').checked){try{validateWeekRange(detailBoardSettings().defaults);}catch(ex){alert(err(ex));return;}}for(const a of [draft.rows,draft.cols,draft.fields]){if(a.some(x=>!String(x.label??x.name).trim())){alert('Alla rader, kolumner och fält behöver ett namn.');return;}}if(draft.fields.filter(f=>f.is_primary).length>2){alert('Max två primära fält.');return;}if(draft.fields.filter(f=>f.color_source).length>1){alert('Högst ett färgstyrande fält.');return;}
// Fältalternativ sparas som text i varje lapp. Spåra namnändringar innan vi ändrar fältdefinitioner.
 const renames=[];const deleted=[];
 if(editingBoard){
  for(const current of fields.filter(f=>f.kind==='select')){
   const next=draft.fields.find(f=>f.id===current.id);
   if(!next)continue;
   if(next.kind!=='select'){
    // Vid byte av typ behåll gamla värden som fritext; de försvinner inte ur databasen.
    continue;
   }
   const remaining=new Set((next.options||[]).map(o=>o._originalLabel).filter(Boolean));
   for(const old of current.options||[]){
    if(!remaining.has(old.label))deleted.push({fieldId:current.id,label:old.label});
   }
   for(const option of next.options||[]){
    const from=option._originalLabel,to=option.label.trim();
    if(from&&from!==to)renames.push({fieldId:current.id,from,to});
   }
  }
 }
 $('board-dialog').close();busy=true;try{
  if(editingBoard){
   // Kontrollera även senaste sparade data, inte bara klientens cache.
   const latest=await req(sb.from('pd_cards').select('id,values_json,updated_at').eq('board_id',board.id));
   const removedField=fields.find(f=>!draft.fields.some(x=>x.id===f.id)&&latest.some(c=>c.values_json?.[f.id]));
   if(removedField)throw Error('Fältet "'+removedField.name+'" har sparade värden på lappar. Töm värdena innan du tar bort fältet.');
   const deletionInUse=deleted.find(d=>latest.some(c=>c.values_json?.[d.fieldId]===d.label));
   if(deletionInUse)throw Error('Alternativet "'+deletionInUse.label+'" används på befintliga lappar. Byt namn i stället eller flytta lapparna till ett annat alternativ innan du tar bort det.');
   for(const card of latest){
    const values={...(card.values_json||{})};let changed=false;
    for(const change of renames){if(values[change.fieldId]===change.from){values[change.fieldId]=change.to;changed=true;}}
    if(!changed)continue;
    const result=await req(sb.from('pd_cards').update({values_json:values}).eq('id',card.id).eq('updated_at',card.updated_at).select('id'));
    if(!result.length)throw Error('En lapp ändrades samtidigt av någon annan. Uppdatera tavlan och försök igen.');
   }
  }
 let bid;if(editingBoard){bid=board.id;const boardChanges={name,detail_settings:detailBoardSettings()};if(subtitle!==(board.subtitle||''))boardChanges.subtitle=subtitle;await req(sb.from('pd_boards').update(boardChanges).eq('id',bid));}else{const newBoard={workspace_id:workspace.id,name,detail_settings:detailBoardSettings()};if(subtitle)newBoard.subtitle=subtitle;const b=await req(sb.from('pd_boards').insert(newBoard).select().single());bid=b.id;}
// Behåll UUID för befintliga rader, kolumner och fält. Ändringar syns hos samtliga användare.
for(const [table,items,orig] of [['pd_rows',draft.rows,rows],['pd_columns',draft.cols,columns],['pd_fields',draft.fields,fields]]){
for(let i=0;i<items.length;i++){const x=items[i];const record={board_id:bid,sort_order:(i+1)*1000};if(table==='pd_fields'){Object.assign(record,{name:x.name.trim(),kind:x.kind,is_primary:!!x.is_primary,color_source:!!x.color_source,options:x.kind==='select'?(x.options||[]).filter(o=>o.label.trim()).map(o=>({label:o.label.trim(),color:o.color})):[]});}else record.label=x.label.trim();if(x.id){await req(sb.from(table).update(record).eq('id',x.id));}else{await req(sb.from(table).insert(record));}}
if(editingBoard){const retained=new Set(items.map(x=>x.id).filter(Boolean));for(const old of orig)if(!retained.has(old.id)){// Tar inte bort rader/kolumner med lappar.
if(table==='pd_rows'||table==='pd_columns'){const fk=table==='pd_rows'?'row_id':'column_id';const {count,error}=await sb.from('pd_cards').select('id',{count:'exact',head:true}).eq(fk,old.id);if(error)throw error;if(count>0)throw Error('Kan inte ta bort "'+old.label+'": flytta först dess '+count+' lappar.');}
await req(sb.from(table).delete().eq('id',old.id));}}
}
boards=await req(sb.from('pd_boards').select('*').eq('workspace_id',workspace.id).order('created_at'));
await openBoard(bid);
info('Tavlan sparad ✓');
}catch(x){alert('Kunde inte spara allt: '+err(x)+'\nUppdatera tavlan innan du försöker igen.');if(board)await reloadBoard().catch(()=>{});}finally{busy=false;}};
async function duplicateBoard(id){const original=boards.find(b=>b.id===id);const newName=await ask('Duplicera tavla','Alla rader, kolumner, fält och lappar kopieras. Originalet påverkas inte.','Nytt namn',original.name+' (kopia)');if(!newName)return;try{const [r,c,f,n]=await Promise.all(['pd_rows','pd_columns','pd_fields','pd_cards'].map(t=>req(sb.from(t).select('*').eq('board_id',id).order('sort_order'))));const newBoard=await req(sb.from('pd_boards').insert({workspace_id:workspace.id,name:newName,...(original.subtitle?{subtitle:original.subtitle}:{}),...(original.detail_settings?{detail_settings:original.detail_settings}:{})}).select().single());const rowMap=new Map(),colMap=new Map(),fieldMap=new Map();for(const [table,items,map] of [['pd_rows',r,rowMap],['pd_columns',c,colMap],['pd_fields',f,fieldMap]])for(const x of items){const payload={board_id:newBoard.id,sort_order:x.sort_order};if(table==='pd_fields')Object.assign(payload,{name:x.name,kind:x.kind,is_primary:x.is_primary,color_source:x.color_source,options:x.options});else payload.label=x.label;const newer=await req(sb.from(table).insert(payload).select().single());map.set(x.id,newer.id);}for(const x of n){const values={};for(const [key,val] of Object.entries(x.values_json||{})){if(fieldMap.has(key))values[fieldMap.get(key)]=val;else if(key==='_planbrow_detail')values[key]=val;}await req(sb.from('pd_cards').insert({board_id:newBoard.id,row_id:rowMap.get(x.row_id),column_id:colMap.get(x.column_id),title:x.title,values_json:values,sort_order:x.sort_order}));}await openWorkspace(workspace.id);info('Tavlan kopierad ✓');}catch(e){alert('Kopieringen kunde inte slutföras: '+err(e));}};
async function deleteBoard(id){
 const target=boards.find(b=>b.id===id);if(!target)return;
 if(!await confirmAction('Ta bort tavlan ”'+target.name+'” och alla dess lappar? Detta går inte att ångra.','Ta bort tavla?',true))return;
 try{await req(sb.rpc('pd_delete_board',{target_board:id}));if(board?.id===id){board=null;rows=[];columns=[];fields=[];cards=[];}await openWorkspace(workspace.id);info('Tavlan borttagen ✓');}
 catch(e){alert('Kunde inte ta bort tavlan: '+err(e));}
}
$('button-logout').onclick=async()=>{if(channel){await sb.removeChannel(channel);channel=null;}await sb.auth.signOut();user=null;recoveryMode=false;showOnly('auth');$('button-logout').hidden=true;info('Utloggad');};
$('button-reconfig').onclick=()=>showOnly('config');
async function establish(){
 const {data,error}=await sb.auth.getSession();if(error)throw error;
 user=data.session?.user||null;
 // Visa aldrig lösenordsformuläret förrän återställningslänken har gett en giltig session.
 if(recoveryMode){
  $('button-logout').hidden=true;
  showOnly('auth');
  if(user){openRecoveryDialog();}
  else feedback('auth-feedback','Återställningslänken kunde inte verifieras eller har gått ut. Begär en ny länk via Glömt lösenord.',true);
  return;
 }
 if(!user){$('button-logout').hidden=true;showOnly('auth');return;}$('button-logout').hidden=false;await home();}
async function connect(url,key){if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url))throw Error('Kontrollera Project URL');if(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))throw Error('Använd endast publishable/anon-nyckel');sb=createClient(url.replace(/\/$/,''),key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});if(authSubscription)authSubscription.unsubscribe();authSubscription=sb.auth.onAuthStateChange((event,session)=>{
 if(event==='PASSWORD_RECOVERY'){
  recoveryDetectedByEvent=true;
  recoveryMode=true;
  // Callbacken måste hållas synkron; Supabase tillåter inte await av auth-anrop här.
  setTimeout(()=>{
   user=session?.user||user;
   showOnly('auth');
   if(user)openRecoveryDialog();
   else establish().catch(x=>feedback('auth-feedback',err(x),true));
  },0);
 }
}).data.subscription;localStorage.setItem(CONN,JSON.stringify({url,key}));await establish();}
$('config-form').onsubmit=async e=>{e.preventDefault();try{await connect($('url').value.trim(),$('key').value.trim());}catch(e){alert(err(e));}};
$('auth-form').onsubmit=async e=>{e.preventDefault();try{const {error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await establish();}catch(e){feedback('auth-feedback',e?.message==='Invalid login credentials'?'Inloggningen misslyckades. Kontrollera e-postadress och lösenord, eller välj Glömt lösenord.':'Inloggningen misslyckades: '+err(e),true);}};
function openRecoveryDialog(){
 const d=$('recovery-dialog');if(d.open)return;
 feedback('recovery-feedback','');
 openDialogQuietly(d);
}
$('recovery-cancel').onclick=()=>{
 $('recovery-dialog').close();recoveryMode=false;
 history.replaceState(null,'',window.location.pathname);
 showOnly('auth');
 feedback('auth-feedback','Lösenordet har inte ändrats. Du kan begära en ny återställningslänk.');
};
for(const b of document.querySelectorAll('[data-toggle]')){b.addEventListener('click',()=>{const t=$(b.dataset.toggle),show=t.type==='password';t.type=show?'text':'password';b.textContent=show?'Dölj':'Visa';b.setAttribute('aria-label',show?'Dölj lösenord':'Visa lösenord');});}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('button-register').onclick=()=>{$('register-form').reset();$('register-email').value=$('email').value.trim();feedback('register-feedback','');openDialogQuietly($('register-dialog'));};
$('register-form').onsubmit=async e=>{e.preventDefault();const email=$('register-email').value.trim(),password=$('register-password').value;if(password!==$('register-confirm').value){feedback('register-feedback','Lösenorden matchar inte.',true);return;}const btn=e.submitter;btn.disabled=true;feedback('register-feedback','Registrerar kontot…');try{const {error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname}});if(error)throw error;feedback('register-feedback','Kontot är registrerat. Kontrollera din e-post för en bekräftelselänk om den krävs.');$('register-password').value='';$('register-confirm').value='';}catch(x){feedback('register-feedback',err(x),true);}finally{btn.disabled=false;}};
$('button-forgot').onclick=()=>{$('forgot-email').value=$('email').value.trim();feedback('forgot-feedback','');openDialogQuietly($('forgot-dialog'));};
$('forgot-form').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;feedback('forgot-feedback','Skickar…');try{const {error}=await sb.auth.resetPasswordForEmail($('forgot-email').value.trim(),{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;feedback('forgot-feedback','Om adressen har ett konto skickas ett återställningsmejl. Kontrollera även skräpposten.');}catch(x){feedback('forgot-feedback','Kunde inte skicka mejlet: '+err(x),true);}finally{btn.disabled=false;}};
$('recovery-form').onsubmit=async e=>{e.preventDefault();const password=$('recovery-password').value;if(password!==$('recovery-confirm').value){feedback('recovery-feedback','Lösenorden matchar inte.',true);return;}const btn=e.submitter;btn.disabled=true;feedback('recovery-feedback','Sparar…');try{const {error}=await sb.auth.updateUser({password});if(error)throw error;feedback('recovery-feedback','Lösenordet är ändrat! Logga in med det nya lösenordet.');$('recovery-password').value='';$('recovery-confirm').value='';recoveryMode=false;history.replaceState(null,'',window.location.pathname);await sb.auth.signOut();setTimeout(()=>{$('recovery-dialog').close();showOnly('auth');feedback('auth-feedback','Lösenordet är uppdaterat. Logga in med ditt nya lösenord.');},300);}catch(x){feedback('recovery-feedback',err(x),true);}finally{btn.disabled=false;}};
/* PlanBroW 2.6.1 – veckoperioder kan anpassas per år. */
const BASE_PERIODS=[{name:'Vårservice',from:5,to:10},{name:'Höstservice',from:40,to:46}];
const DETAIL_DEFAULTS={view:'timeline',scale:'day',periods:BASE_PERIODS};
function copyPeriods(arr){return (Array.isArray(arr)?arr:BASE_PERIODS).map(p=>({name:String(p.name||'Period'),from:Number(p.from),to:Number(p.to)}));}
function validatePeriods(periods){
 if(!periods.length||periods.length>12)throw Error('Välj 1–12 perioder per år.');
 const clean=periods.map(p=>({name:String(p.name||'').trim(),from:Number(p.from),to:Number(p.to)}));
 for(const p of clean){if(!p.name||!Number.isInteger(p.from)||!Number.isInteger(p.to)||p.from<1||p.to>53||p.to<p.from)throw Error('Ge alla perioder namn och ange giltiga hela veckor (1–53).');}
 const sorted=[...clean].sort((a,b)=>a.from-b.from);
 for(let i=1;i<sorted.length;i++)if(sorted[i].from<=sorted[i-1].to)throw Error('Perioderna får inte överlappa.');
 return clean;
}
function periodsFromSettings(s){
 if(Array.isArray(s.periods)&&s.periods.length)return copyPeriods(s.periods);
 if(s.from!=null&&s.to!=null&&Number(s.from)<=Number(s.to)&&!(Number(s.from)===1&&Number(s.to)===53))return [{name:'Planeringsperiod',from:Number(s.from),to:Number(s.to)}];
 return copyPeriods(BASE_PERIODS);
}
function normalizedDetail(s){return {...DETAIL_DEFAULTS,...s,scale:s?.scale==='week'?'week':'day',periods:periodsFromSettings(s||{})};}
function periodEditor(id,periods){const host=$(id);host.replaceChildren();for(const item of periods){const line=el('div','period-line');
 const mk=(label,type,value)=>{const field=el('label','control',label),input=el('input');input.type=type;input.value=value;if(type==='number'){input.min=1;input.max=53;input.step=1;}field.append(input);line.append(field);return input;};
 mk('Periodnamn','text',item.name).maxLength=70;mk('Från vecka','number',item.from);mk('Till vecka','number',item.to);
 const del=el('button','','✕');del.type='button';del.title='Ta bort period';del.onclick=()=>{line.remove();if(id==='year-periods-editor')$('year-inherit').checked=false;toggleYearInputs();};line.append(del);host.append(line);
 if(id==='year-periods-editor')line.addEventListener('input',()=>{$('year-inherit').checked=false;toggleYearInputs();});
 }}
function collectPeriods(id){return validatePeriods([...$(id).children].map(line=>{const inputs=line.querySelectorAll('input');return {name:inputs[0].value,from:Number(inputs[1].value),to:Number(inputs[2].value)};}));}
function addPeriod(id){const arr=[...$(id).children].map(line=>{const ins=line.querySelectorAll('input');return {name:ins[0].value,from:Number(ins[1].value),to:Number(ins[2].value)};});if(arr.length>=12){alert('Max 12 perioder.');return;}arr.push({name:'Ny period',from:Math.min(53,(arr.at(-1)?.to||0)+1),to:Math.min(53,(arr.at(-1)?.to||0)+1)});periodEditor(id,arr);if(id==='year-periods-editor')$('year-inherit').checked=false;toggleYearInputs();}
$('board-add-period').onclick=()=>addPeriod('board-periods-editor');
$('year-add-period').onclick=()=>addPeriod('year-periods-editor');
function detailBoardSettings(){return {enabled:$('board-detail-enabled').checked,defaults:{view:$('detail-default-view').value,scale:$('detail-default-scale').value,periods:collectPeriods('board-periods-editor')},years:{...(editingBoard?board?.detail_settings?.years||{}:{})}};}
function readDetailSettings(){const ds=board?.detail_settings||{};return {enabled:!!ds.enabled,defaults:normalizedDetail(ds.defaults||{}),years:{...(ds.years||{})}};}
function yearSettings(year){const s=readDetailSettings();return normalizedDetail({...s.defaults,...(s.years[year]||{})});}
function validateWeekRange(input){return {...input,periods:validatePeriods(periodsFromSettings(input))};}
function showDetailPanels(show){$('year-detail').hidden=!show;$('board').hidden=show;$('presentation-heading').hidden=true;$('viewbar').hidden=show;$('board-area').classList.toggle('detail-active',show);const ctrl=$('board-area').querySelector('.presentation-controls');ctrl.hidden=show;$('board-area').querySelector('.hint').hidden=show;$('button-settings').hidden=show;$('button-add-card').hidden=show;}
function openDetailYear(id){if(!board?.detail_settings?.enabled)return;const row=rows.find(x=>x.id===id);if(!row||!/^20\d{2}$/.test(row.label.trim()))return;detailYear=id;detailViewOverride=null;showDetailPanels(true);renderDetailYear();$('year-detail').scrollIntoView({block:'start'});}
function leaveDetailYear(){detailYear=null;detailViewOverride=null;showDetailPanels(false);$('button-settings').hidden=false;$('button-add-card').hidden=false;renderBoard();}
$('year-back').onclick=leaveDetailYear;
$('year-new-card').onclick=()=>{if(detailYear&&columns.length)editCard(null,detailYear,columns[0].id);};
$('year-view').onchange=()=>{detailViewOverride=$('year-view').value;renderDetailYear();};
$('year-filter').onchange=renderDetailYear;
$('year-status-filter').onchange=renderDetailYear;
function detailCardInfo(card){const meta=card.values_json?._planbrow_detail||{};return {start:meta.start||'',end:meta.end||'',downtime:meta.downtime??'',unit:meta.unit||'dagar',status:meta.status||'Preliminär'};}
function parseIsoDate(str){if(!/^\d{4}-\d\d-\d\d$/.test(str||''))return null;const d=new Date(str+'T00:00:00Z');return Number.isNaN(d.getTime())?null:d;}
function weekOfYear(date){const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const y=new Date(Date.UTC(d.getUTCFullYear(),0,1));return Math.ceil((((d-y)/86400000)+1)/7);}
function weekInDisplayedYear(date,year){const week=weekOfYear(date);const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));if(d.getUTCFullYear()<year)return 1;if(d.getUTCFullYear()>year)return 53;return week;}
function scheduleSpan(info,year){const s=parseIsoDate(info.start),e=parseIsoDate(info.end);if(!s||!e||e<s)return null;const first=new Date(Date.UTC(year,0,1)),last=new Date(Date.UTC(year,11,31));if(e<first||s>last)return null;return [weekInDisplayedYear(s,year),weekInDisplayedYear(e,year)];}
function weekLabel(meta){const s=parseIsoDate(meta.start),e=parseIsoDate(meta.end);if(!s||!e)return 'Ej tidsatt';return 'v'+weekOfYear(s)+(weekOfYear(s)===weekOfYear(e)?'':'–'+weekOfYear(e));}
function yearColor(card){return fieldColor(card);}
function makeYearEdit(card){const b=el('button','year-row-edit',card.title);b.type='button';b.onclick=()=>editYearActivity(card.id);return b;}
function renderDetailYear(){if(!detailYear||!board)return;const r=rows.find(x=>x.id===detailYear);if(!r){leaveDetailYear();return;}const year=Number(r.label);const settings=validateWeekRange(yearSettings(String(year)));const view=detailViewOverride||settings.view;
 $('year-title').textContent=r.label+' – Detaljplanering';$('year-crumb').textContent=(board.name||'Tavla')+' / '+r.label;
 $('year-view').value=view;$('year-timeline').hidden=view!=='timeline';$('year-list').hidden=view!=='list';
 const catField=fields.find(f=>f.color_source)||fields.find(f=>f.is_primary);
 const select=$('year-filter'),previous=select.value;select.replaceChildren();const all=el('option','','Alla kategorier');all.value='';select.append(all);
 if(catField){for(const opt of (catField.options||[])){const x=el('option','',opt.label);x.value=opt.label;select.append(x);}}if([...select.options].some(x=>x.value===previous))select.value=previous;
 const arr=cards.filter(c=>c.row_id===r.id&&(!select.value||c.values_json?.[catField?.id]===select.value)&&(!$('year-status-filter').value||detailCardInfo(c).status===$('year-status-filter').value));
 $('year-hint').textContent=arr.length+' aktiviteter · '+settings.periods.length+' perioder · '+(settings.scale==='week'?'Veckovisning':'Dagsvisning')+' · Klicka på en aktivitet för att ange datum och stopptid.';
 if(view==='timeline')renderYearTimeline(arr,settings,year);else{$('year-untimed').hidden=true;renderYearList(arr,year);}
}
function isoUTC(s){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');if(!m)return null;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?d:null;}
function isoDay(d){return d.toISOString().slice(0,10);}
function mondayOfISOWeek(year,week){const jan4=new Date(Date.UTC(year,0,4)),weekday=(jan4.getUTCDay()+6)%7;jan4.setUTCDate(jan4.getUTCDate()-weekday+(week-1)*7);return jan4;}
function incrementDay(d,n){const copy=new Date(d);copy.setUTCDate(copy.getUTCDate()+n);return copy;}
function renderYearTimeline(arr,settings,year){
 const host=$('year-timeline');host.replaceChildren();const periods=validatePeriods(settings.periods).sort((a,b)=>a.from-b.from);
 const planned=arr.filter(c=>{const x=detailCardInfo(c);return isoUTC(x.start)&&isoUTC(x.end)&&x.end>=x.start;});
 const untimed=arr.filter(c=>!planned.includes(c));
 for(const [idx,p] of periods.entries()){
  const countWeeks=p.to-p.from+1,fromDate=mondayOfISOWeek(year,p.from),toDate=incrementDay(mondayOfISOWeek(year,p.to),6),numDays=countWeeks*(settings.scale==='week'?1:7);
  const section=el('section','detail-period');section.dataset.periodIndex=String(idx);
  const head=el('div','detail-period-header');head.append(el('h3','',p.name+' · v'+p.from+'–v'+p.to),el('span','','Planering '+year));section.append(head);
  const scroll=el('div','detail-period-scroll');const inner=el('div','detail-period-inner');inner.style.setProperty('--days',numDays);
  inner.style.setProperty('--dayw',settings.scale==='week'?'62px':'29px');
  const weekRow=el('div','detail-week-row');weekRow.append(el('div','detail-fixed-label','Linje / aktivitet'));
  for(let w=p.from;w<=p.to;w++){const span=el('div','detail-week-head','v'+w);span.style.gridColumn=(2+(w-p.from)*(settings.scale==='week'?1:7))+' / span '+(settings.scale==='week'?1:7);weekRow.append(span);}inner.append(weekRow);
  if(settings.scale!=='week'){const days=el('div','detail-day-row');days.append(el('div','detail-fixed-label','Veckodag'));for(let d=0;d<numDays;d++){const date=incrementDay(fromDate,d);const mark=el('div','detail-day-head'+(d%7>=5?' weekend':''),['M','T','O','T','F','L','S'][d%7]+' '+date.getUTCDate());mark.style.gridColumn=String(d+2);days.append(mark);}inner.append(days);}
  let shown=0;
  for(const card of planned){const meta=detailCardInfo(card),begin=isoUTC(meta.start),finish=isoUTC(meta.end);if(finish<fromDate||begin>toDate)continue;shown++;
   const [paper,edge]=yearColor(card),line=el('div','detail-service-row');const label=el('div','detail-fixed-label');label.append(makeYearEdit(card));line.append(label);
   const grid=el('div','detail-day-grid');for(let d=0;d<numDays;d++){const cell=el('span',settings.scale!=='week'&&d%7>=5?'weekend':'');grid.append(cell);}line.append(grid);
   const clippedStart=begin<fromDate?fromDate:begin,clippedEnd=finish>toDate?toDate:finish;
   const startUnits=settings.scale==='week'?Math.floor((clippedStart-fromDate)/604800000):Math.round((clippedStart-fromDate)/86400000);
   const endUnits=settings.scale==='week'?Math.floor((clippedEnd-fromDate)/604800000):Math.round((clippedEnd-fromDate)/86400000);
   const bar=el('button','detail-service-bar',card.title+(meta.downtime!==''?' · '+meta.downtime+' '+meta.unit:''));bar.type='button';bar.style.gridColumn=(2+startUnits)+' / '+(3+endUnits);bar.style.setProperty('--paper',paper);bar.style.setProperty('--edge',edge);bar.title=card.title+' • '+meta.start+' – '+meta.end+' • '+meta.status;bar.onclick=()=>editYearActivity(card.id);line.append(bar);inner.append(line);
  }
  if(!shown){const empty=el('p','muted','Inga tidsatta aktiviteter i den här perioden.');empty.style.padding='14px';inner.append(empty);}
  scroll.append(inner);section.append(scroll);host.append(section);
 }
 const outside=planned.filter(c=>{const m=detailCardInfo(c),s=isoUTC(m.start),e=isoUTC(m.end);return !periods.some(p=>e>=mondayOfISOWeek(year,p.from)&&s<=incrementDay(mondayOfISOWeek(year,p.to),6));});
 const untimedHost=$('year-untimed');untimedHost.replaceChildren();untimedHost.hidden=!untimed.length&&!outside.length;
 function appendExtras(title,items){if(!items.length)return;untimedHost.append(el('h3','',title+' ('+items.length+')'));const wrap=el('div','year-untimed-cards');for(const card of items){const [paper,edge]=yearColor(card),btn=el('button','',card.title);btn.type='button';btn.style.setProperty('--paper',paper);btn.style.setProperty('--edge',edge);btn.onclick=()=>editYearActivity(card.id);wrap.append(btn);}untimedHost.append(wrap);}
 appendExtras('Ej tidsatta aktiviteter',untimed);appendExtras('Utanför valda perioder',outside);
}
function renderYearList(arr,year){const host=$('year-list');host.replaceChildren();const table=el('table');const head=el('thead');const tr=el('tr');for(const text of ['Aktivitet','Kategori','Vecka','Start','Slut','Planerad stopptid','Status'])tr.append(el('th','',text));head.append(tr);table.append(head);const body=el('tbody');const catField=fields.find(f=>f.color_source)||fields.find(f=>f.is_primary);
 for(const card of arr){const info=detailCardInfo(card),tr=el('tr');const first=el('td');first.append(makeYearEdit(card));tr.append(first);for(const val of [card.values_json?.[catField?.id]||'—',weekLabel(info),info.start||'—',info.end||'—',info.downtime!==''?info.downtime+' '+info.unit:'—',info.status])tr.append(el('td','',val));body.append(tr);}table.append(body);host.append(table);if(!arr.length)host.append(el('p','muted','Inga aktiviteter matchar filtret.'));}
$('year-settings').onclick=()=>{if(!detailYear)return;const year=rows.find(r=>r.id===detailYear)?.label,ds=readDetailSettings(),override=ds.years[year];const val=yearSettings(year);
 $('year-settings-title').textContent='Inställningar · '+year;$('year-inherit').checked=!override;
 $('year-config-view').value=val.view;$('year-config-scale').value=val.scale;periodEditor('year-periods-editor',val.periods);toggleYearInputs();openDialogQuietly($('year-settings-dialog'));
};
function toggleYearInputs(){$('year-overrides').classList.toggle('inheriting',$('year-inherit').checked);}
$('year-inherit').onchange=toggleYearInputs;
for(const id of ['year-config-view','year-config-scale'])$(id).onchange=()=>{$('year-inherit').checked=false;toggleYearInputs();};
$('year-settings-form').onsubmit=async e=>{e.preventDefault();if(!detailYear||busy)return;
 const year=rows.find(r=>r.id===detailYear)?.label,ds=readDetailSettings();
 if($('year-inherit').checked)delete ds.years[year];else{
  try{ds.years[year]={view:$('year-config-view').value,scale:$('year-config-scale').value,periods:collectPeriods('year-periods-editor')};}catch(ex){alert(err(ex));return;}
 }
 try{busy=true;const updated=await req(sb.from('pd_boards').update({detail_settings:ds}).eq('id',board.id).select('*').single());board=updated;boards=boards.map(b=>b.id===board.id?board:b);detailViewOverride=null;$('year-settings-dialog').close();renderDetailYear();info('Årsinställningar sparade ✓');}
 catch(ex){alert('Kunde inte spara årsinställningar: '+err(ex));}finally{busy=false;}
};
function editYearActivity(id){const card=cards.find(x=>x.id===id);if(!card)return;detailEditingCard=id;const info=detailCardInfo(card);$('year-card-heading').textContent=card.title;$('year-card-context').textContent='Samma lapp på '+board.name+' · '+rows.find(r=>r.id===card.row_id)?.label;$('year-card-start').value=info.start;$('year-card-end').value=info.end;$('year-card-start-picker').value=info.start;$('year-card-end-picker').value=info.end;$('year-card-end').dataset.autofill=info.end?'false':'true';$('year-card-downtime').value=info.downtime;$('year-card-unit').value=info.unit;$('year-card-status').value=info.status;$('year-card-start').dataset.previousStart=info.start;openDialogQuietly($('year-card-dialog'));}
// Använd svensk ISO-visning oberoende av webbläsarens datumplaceholder.
function setYearEndFromStart(){const begin=$('year-card-start').value.trim(),end=$('year-card-end');if(!isoUTC(begin))return;
 const old=$('year-card-start').dataset.previousStart||'';
 if(!end.value||end.dataset.autofill==='true')end.value=begin;
 else if(old&&isoUTC(old)&&isoUTC(end.value)){
  const days=Math.round((isoUTC(end.value)-isoUTC(old))/86400000);
  end.value=isoDay(incrementDay(isoUTC(begin),Math.max(0,days)));
 }
 if(end.value<begin)end.value=begin;
 end.dataset.autofill='true';$('year-card-start').dataset.previousStart=begin;
 $('year-card-end-picker').value=end.value;$('year-card-end-picker').min=begin;
}
$('year-card-start').addEventListener('change',setYearEndFromStart);
$('year-card-end').addEventListener('change',()=>{$('year-card-end').dataset.autofill='false';});
for(const input of ['year-card-start-picker','year-card-end-picker'])$(input).addEventListener('change',()=>{
 const target=input==='year-card-start-picker'?'year-card-start':'year-card-end';$(target).value=$(input).value;
 if(target==='year-card-start')setYearEndFromStart();else $('year-card-end').dataset.autofill='false';
});
for(const b of document.querySelectorAll('[data-date-picker]'))b.onclick=()=>{
 const picker=$(b.dataset.datePicker),textInput=$(b.dataset.datePicker.replace('-picker',''));
 picker.value=isoUTC(textInput.value)?textInput.value:'';
 if(picker.id==='year-card-end-picker'&&isoUTC($('year-card-start').value))picker.min=$('year-card-start').value;
 try{picker.showPicker();}catch{picker.style.pointerEvents='auto';picker.focus();picker.click();picker.style.pointerEvents='none';}
};
$('year-card-main-edit').onclick=()=>{const id=detailEditingCard;$('year-card-dialog').close();editCard(id);};
$('year-card-form').onsubmit=async e=>{e.preventDefault();if(busy)return;const card=cards.find(x=>x.id===detailEditingCard);if(!card)return;const start=$('year-card-start').value,end=$('year-card-end').value,raw=$('year-card-downtime').value;
 if((start&&!end)||(!start&&end)){alert('Ange både start- och slutdatum, eller lämna båda tomma.');return;}
 if((start&&!isoUTC(start))||(end&&!isoUTC(end))){alert('Ange giltiga datum som ÅÅÅÅ-MM-DD, exempelvis 2027-10-18.');return;}if(start&&end&&end<start){alert('Slutdatum kan inte ligga före startdatum.');return;}
 const downtime=raw===''?'':Number(raw);if(raw!==''&&(!Number.isFinite(downtime)||downtime<0||downtime>3650)){alert('Ange en giltig stopptid.');return;}
 const values={...(card.values_json||{}),_planbrow_detail:{start,end,downtime,unit:$('year-card-unit').value,status:$('year-card-status').value}};
 try{busy=true;const updated=await req(sb.from('pd_cards').update({values_json:values}).eq('id',card.id).eq('updated_at',card.updated_at).select('*'));if(updated.length!==1)throw Error('Lappen har ändrats av någon annan. Uppdatera och försök igen.');$('year-card-dialog').close();await reloadBoard();info('Detaljplanering sparad ✓');}catch(ex){alert('Kunde inte spara: '+err(ex));}finally{busy=false;}};
$('year-export-png').onclick=()=>{
 if(!detailYear)return;const opts=$('year-png-period');opts.replaceChildren();let all=el('option','','Alla perioder');all.value='all';opts.append(all);
 const year=rows.find(r=>r.id===detailYear)?.label;
 yearSettings(year).periods.forEach((p,i)=>{const opt=el('option','',p.name+' · v'+p.from+'–v'+p.to);opt.value=String(i);opts.append(opt);});
 feedback('year-png-feedback','');openDialogQuietly($('year-png-dialog'));
};
$('year-png-cancel').onclick=()=>$('year-png-dialog').close();
$('year-png-form').onsubmit=async e=>{
 e.preventDefault();if(!detailYear)return;const btn=$('year-png-submit');btn.disabled=true;let clone=null;
 const viewSave=detailViewOverride;
 try{
  feedback('year-png-feedback','Förbereder tidslinjen…');const capture=await loadPNGEngine();
  detailViewOverride='timeline';renderDetailYear();
  const choice=$('year-png-period').value;
  clone=el('div');clone.id='detail-png-capture';clone.style.cssText='position:absolute;left:-18000px;top:0;background:#f5f7fb;padding:28px;width:1400px;box-sizing:border-box;color:#17324d;';
  clone.append(el('h1','',board.name+' · '+rows.find(r=>r.id===detailYear)?.label+' – Detaljplanering'));
  if(board.subtitle)clone.append(el('p','',board.subtitle));
  const source=$('year-timeline').cloneNode(true);source.removeAttribute('id');
  if(choice!=='all')source.querySelectorAll('.detail-period').forEach(s=>{if(s.dataset.periodIndex!==choice)s.remove();});
  // Dokumentbredd styrs av längsta valda tidslinje, så exporten inte kapas av intern scroll.
  source.style.cssText='width:max-content;min-width:100%;display:block;';
  source.querySelectorAll('.detail-period-scroll').forEach(x=>{x.style.overflow='visible';x.style.maxWidth='none';});
  clone.append(source);
  if(choice==='all'&&!$('year-untimed').hidden)clone.append($('year-untimed').cloneNode(true));
  document.body.append(clone);
  const width=Math.max(1400,Math.ceil(source.scrollWidth+56));clone.style.width=width+'px';
  const height=Math.ceil(clone.scrollHeight),requested=Number($('year-png-scale').value)||3,mobile=/iPhone|iPad|iPod/i.test(navigator.userAgent),maxPixels=mobile?12000000:32000000;
  const scale=Math.min(requested,Math.sqrt(maxPixels/(width*height)),16000/width,16000/height);
  if(scale<0.55||height>25000)throw Error('Bilden är för stor. Välj en period eller lägre upplösning.');
  feedback('year-png-feedback','Skapar bild ('+Math.round(width*scale)+' × '+Math.round(height*scale)+' pixlar)…');
  const canvas=await capture(clone,{backgroundColor:'#f5f7fb',scale,width,height,windowWidth:Math.max(1450,width),windowHeight:Math.max(900,height),scrollX:0,scrollY:0,useCORS:true,logging:false,onclone:doc=>{const x=doc.getElementById('detail-png-capture');if(x){x.style.left='0px';x.style.top='0px';}}});
  const year=rows.find(r=>r.id===detailYear)?.label;
  await pngDownload(canvas,pdfSafeName(board.name)+'_'+year+'_detalj_'+(choice==='all'?'alla_perioder':'period_'+(Number(choice)+1))+'.png');
  $('year-png-dialog').close();info('Detaljplanering exporterad ✓');
 }catch(ex){feedback('year-png-feedback','Kunde inte exportera: '+err(ex),true);}
 finally{clone?.remove();detailViewOverride=viewSave;renderDetailYear();btn.disabled=false;}
};
$('board-detail-enabled').onchange=()=>{$('board-detail-defaults').querySelectorAll('input,select').forEach(x=>x.disabled=!$('board-detail-enabled').checked);};
// Pull-to-refresh, endast i mobilens översikt vid sidans topp.
let startY=null,pull=0;
const area=$('board-area');area.addEventListener('touchstart',e=>{if(window.matchMedia('(max-width:650px)').matches&&window.scrollY<20&&e.touches.length===1&&!e.target.closest('.note,button,select,input')){startY=e.touches[0].clientY;pull=0;}},{passive:true});
area.addEventListener('touchmove',e=>{if(startY===null||e.touches.length!==1)return;pull=Math.max(0,Math.min(90,e.touches[0].clientY-startY));$('pull-indicator').style.height=(pull*.55)+'px';$('pull-indicator').textContent=pull>65?'Släpp för att uppdatera':'↻ Dra ned för att uppdatera';},{passive:true});
area.addEventListener('touchend',()=>{if(startY!==null&&pull>65)reloadBoard().catch(e=>info(err(e)));startY=null;pull=0;$('pull-indicator').style.height='0';},{passive:true});
try{const saved=JSON.parse(localStorage.getItem(CONN)||'null');if(saved?.url&&saved?.key){$('url').value=saved.url;$('key').value=saved.key;connect(saved.url,saved.key).catch(e=>{showOnly('config');info(err(e));});}else{showOnly('config');$('url').value='https://huxqiwgvsjedjlaaztif.supabase.co';}}catch(e){showOnly('config');info(err(e));}
