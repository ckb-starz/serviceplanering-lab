import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const $=id=>document.getElementById(id), el=(tag,cl,txt)=>{const n=document.createElement(tag);if(cl)n.className=cl;if(txt!==undefined)n.textContent=String(txt);return n;};
const CONN='serviceplanering-lab-connection-v1';
let sb=null, user=null, workspaces=[], workspace=null, boards=[],board=null, rows=[],columns=[],fields=[],cards=[],editingId=null,editingBoard=false,channel=null,drag=null,busy=false,focusedColumn=null;
const templateFields=()=>[{name:'Kategori',kind:'select',is_primary:true,color_source:true,options:[{label:'Alternativ A',color:'#d8eefa'},{label:'Alternativ B',color:'#d9f3dd'}]},{name:'Ansvarig',kind:'select',is_primary:true,color_source:false,options:[{label:'Jag',color:'#eeeeee'}]},{name:'Kommentar',kind:'textarea',is_primary:false,color_source:false,options:[]}];
function info(t){$('status').textContent=t;}
function err(e){return e?.message||String(e);}
const formSnapshots=new Map();
function formString(dialogId){const d=$(dialogId);const inputs=[...d.querySelectorAll('input,textarea,select')].map(i=>[i.type,i.value,i.checked]);return JSON.stringify(inputs);}
function rememberForm(dialogId){formSnapshots.set(dialogId,formString(dialogId));}
function confirmDiscard(dialogId){return formSnapshots.get(dialogId)===formString(dialogId)||confirm('Kasta ändringarna utan att spara?');}
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
function showMain(section){showOnly('main');updateBottomNav(section);for(const id of ['home','boards','board-area'])$(id).hidden=id!==section;$('button-settings').hidden=section!=='board-area';$('button-add-card').hidden=section!=='board-area';$('button-refresh').hidden=section!=='board-area';$('board-selector').hidden=section!=='board-area';$('crumb').textContent=section==='board-area'?(workspace?.name||'')+' / '+(board?.name||''):workspace?.name||'';}
function updateBottomNav(section){
 for(const id of ['nav-home','nav-boards','nav-search','nav-settings'])$(id).classList.remove('active');
 $(section==='home'?'nav-home':'nav-boards').classList.add('active');
}
$('nav-home').onclick=()=>home().catch(e=>alert(err(e)));
$('nav-boards').onclick=()=>{if(workspace)openWorkspace(workspace.id).catch(e=>alert(err(e)));else home().catch(e=>alert(err(e)));};
$('nav-search').onclick=()=>{if(board){const term=prompt('Sök bland lappar på tavlan:');if(term){const found=cards.filter(c=>[c.title,...Object.values(c.values_json||{})].join(' ').toLocaleLowerCase('sv').includes(term.toLocaleLowerCase('sv')));alert(found.length?found.map(c=>c.title).join('\n'):'Inga träffar.');}}else alert('Öppna en tavla för att söka bland lappar.');};
$('nav-settings').onclick=()=>{if(board)editBoard(board);else alert('Öppna en tavla för att anpassa den.');};
async function dbLoad(){return await req(sb.from('pd_workspaces').select('*').order('created_at'));}
async function home(){workspace=null;board=null;focusedColumn=null;if(channel){await sb.removeChannel(channel);channel=null;}workspaces=await dbLoad();showMain('home');
 const recent=$('recent-boards');recent.replaceChildren();
 try{const boardItems=await req(sb.from('pd_boards').select('id,name,workspace_id,created_at').order('created_at',{ascending:false}).limit(8));
  if(!boardItems.length)recent.append(el('div','home-empty','Inga tavlor ännu. Skapa en tavla för att komma igång.'));
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
$('new-workspace').onclick=async()=>{const name=await ask('Ny arbetsyta','Bara du ser arbetsytan tills du lägger till medlemmar.','Exempel: Familjen');if(!name)return;try{const wid=await req(sb.rpc('pd_create_workspace',{workspace_name:name}));await home();await openWorkspace(wid);}catch(e){alert(err(e));}};
async function openWorkspace(id){workspace=workspaces.find(w=>w.id===id)||null;if(!workspace){workspace=await req(sb.from('pd_workspaces').select('*').eq('id',id).single());}board=null;boards=await req(sb.from('pd_boards').select('*').eq('workspace_id',id).order('created_at'));showMain('boards');$('workspace-name').textContent=workspace.name;const r=$('board-list');r.replaceChildren();if(!boards.length)r.append(el('p','muted','Här finns inga tavlor ännu.'));for(const b of boards){const d=el('div','workspace-item');d.append(el('strong','',b.name));const actions=el('div','line');const open=el('button','','Öppna →');open.onclick=()=>openBoard(b.id);const dup=el('button','','Duplicera');dup.onclick=()=>duplicateBoard(b.id);const remove=el('button','danger','Ta bort');remove.title='Radera tavlan permanent';remove.onclick=()=>deleteBoard(b.id);actions.append(open,dup,remove);d.append(actions);r.append(d);}info(boards.length+' tavlor');}
$('go-home').onclick=()=>home().catch(e=>alert(err(e)));
$('new-board').onclick=()=>editBoard(null);
$('invite-member').onclick=async()=>{if(!workspace)return;const address=await ask('Lägg till en medlem','Personen måste redan ha registrerat ett konto i appen. Du kan bara bjuda in om du äger arbetsytan.','e-postadress');if(!address)return;try{const msg=await req(sb.rpc('pd_add_member',{wid:workspace.id,member_email:address,new_role:'editor'}));alert(msg||'Klart');}catch(e){alert(err(e));}};
async function openBoard(id){board=boards.find(b=>b.id===id)||await req(sb.from('pd_boards').select('*').eq('id',id).single());focusedColumn=null;await reloadBoard();showMain('board-area');$('current-name').textContent=board.name;renderSelector();renderBoard();subscribe();}
async function reloadBoard(){if(!board)return;const bid=board.id;const [r,c,f,n]=await Promise.all([req(sb.from('pd_rows').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_columns').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_fields').select('*').eq('board_id',bid).order('sort_order')),req(sb.from('pd_cards').select('*').eq('board_id',bid).order('sort_order'))]);if(board?.id!==bid)return;rows=r;columns=c;fields=f;cards=n;renderBoard();info('Synkroniserat • '+n.length+' lappar');}
function renderSelector(){const s=$('board-selector');s.replaceChildren();for(const b of boards){const o=el('option','',b.name);o.value=b.id;s.append(o);}s.value=board.id;}
$('board-selector').onchange=e=>openBoard(e.target.value).catch(x=>alert(err(x)));
function fieldColor(card){const f=fields.find(f=>f.color_source);if(!f)return ['#eef2f5','#9ba8b4'];const val=card.values_json?.[f.id];const opt=Array.isArray(f.options)?f.options.find(o=>o.label===val):null;return [opt?.color||'#eef2f5',opt?.color||'#9ba8b4'];}
const expanded=new Set();
function cardElement(card,siblings,index){const n=el('article','note');n.dataset.cardId=card.id;n.tabIndex=0;n.setAttribute('role','button');n.setAttribute('aria-expanded',expanded.has(card.id)?'true':'false');const [paper,edge]=fieldColor(card);n.style.setProperty('--paper',paper);n.style.setProperty('--edge',edge);const top=el('div','note-labels');const primary=fields.filter(f=>f.is_primary).slice(0,2);for(const f of primary){const v=card.values_json?.[f.id];if(v)top.append(el('span','',v));}if(top.childNodes.length)n.append(top);n.append(el('div','note-name',card.title));const reveal=expanded.has(card.id)||Boolean(focusedColumn);if(reveal){const extra=el('div','note-extra');for(const f of fields){if(!focusedColumn&&f.is_primary)continue;const v=card.values_json?.[f.id];if(!v)continue;const pair=el('div','kv');pair.append(el('span','key',f.name),el('span','field-value',v));extra.append(pair);}const actions=el('div','note-tools');const edit=el('button','','✎ Redigera');edit.onclick=e=>{e.stopPropagation();editCard(card.id);};const up=el('button','','↑');up.title='Flytta upp';up.disabled=index===0;up.onclick=e=>{e.stopPropagation();reorderCard(card,-1);};const down=el('button','','↓');down.title='Flytta ned';down.disabled=index===siblings.length-1;down.onclick=e=>{e.stopPropagation();reorderCard(card,1);};actions.append(edit,up,down);extra.append(actions);n.append(extra);}n.onclick=e=>{if(suppressNextClick){e.preventDefault();return;}if(e.target.closest('button'))return;if(expanded.has(card.id))expanded.delete(card.id);else expanded.add(card.id);renderBoard();};n.onkeydown=e=>{if(e.key==='Enter'&&e.target===n){e.preventDefault();n.click();}};
if(window.matchMedia('(min-width:651px)').matches){n.draggable=true;n.addEventListener('dragstart',e=>{drag=card.id;n.classList.add('dragging');e.dataTransfer.setData('text/plain',card.id);});n.addEventListener('dragend',()=>{drag=null;n.classList.remove('dragging');});n.addEventListener('dragover',e=>{if(drag&&drag!==card.id)e.preventDefault();});n.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();if(drag&&drag!==card.id)moveCard(drag,card.row_id,card.column_id,card.id);drag=null;});}
if(window.matchMedia('(max-width:650px)').matches)installTouchDrag(n,card);
return n;}
let activeTouchDrag=null,suppressNextClick=false;
function installTouchDrag(node,card){
  let timer=null,initial=null;
  const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};
  node.addEventListener('contextmenu',e=>e.preventDefault());
  node.addEventListener('selectstart',e=>e.preventDefault());
  node.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||e.target.closest('button,input,select,textarea'))return;
    const t=e.touches[0];initial={x:t.clientX,y:t.clientY};
    clear();timer=setTimeout(()=>{
      timer=null;
      if(!initial||activeTouchDrag)return;
      const ghost=node.cloneNode(true);
      ghost.classList.add('touch-ghost');ghost.style.width=Math.min(node.getBoundingClientRect().width,window.innerWidth-25)+'px';
      ghost.style.left=Math.max(6,Math.min(window.innerWidth-ghost.offsetWidth-6,initial.x-65))+'px';
      ghost.style.top=Math.max(6,initial.y-22)+'px';
      document.body.append(ghost);node.classList.add('dragging');
      activeTouchDrag={id:card.id,source:node,ghost,target:null};
      if(window.getSelection)window.getSelection().removeAllRanges();if(navigator.vibrate)navigator.vibrate(20);
    },420);
  },{passive:true});
  node.addEventListener('touchmove',e=>{
    if(!initial||e.touches.length!==1)return;
    const t=e.touches[0];
    if(!activeTouchDrag){if(Math.hypot(t.clientX-initial.x,t.clientY-initial.y)>10){clear();initial=null;}return;}
    if(activeTouchDrag.id!==card.id)return;
    e.preventDefault();
    const g=activeTouchDrag.ghost;
    g.style.left=Math.max(5,Math.min(window.innerWidth-g.offsetWidth-5,t.clientX-g.offsetWidth/2))+'px';
    g.style.top=Math.max(5,Math.min(window.innerHeight-g.offsetHeight-5,t.clientY-22))+'px';
    document.querySelectorAll('.touch-over').forEach(x=>x.classList.remove('touch-over'));
    const target=document.elementFromPoint(t.clientX,t.clientY);
    const cell=target?.closest('.cell');
    if(cell){cell.classList.add('touch-over');const targetCard=target.closest('.note');activeTouchDrag.target={row:cell.dataset.row,column:cell.dataset.column,before:targetCard?.dataset.cardId!==card.id?targetCard?.dataset.cardId:null};}
    else activeTouchDrag.target=null;
  },{passive:false});
  const end=()=>{
    clear();initial=null;
    if(!activeTouchDrag||activeTouchDrag.id!==card.id)return;
    const {source,ghost,target,id}=activeTouchDrag;
    activeTouchDrag=null;ghost.remove();source.classList.remove('dragging');
    document.querySelectorAll('.touch-over').forEach(x=>x.classList.remove('touch-over'));
    suppressNextClick=true;setTimeout(()=>suppressNextClick=false,500);
    if(target)moveCard(id,target.row,target.column,target.before).catch(e=>alert(err(e)));
  };
  node.addEventListener('touchend',end,{passive:true});
  node.addEventListener('touchcancel',end,{passive:true});
}
function renderBoard(){if(!board||!$('board-grid'))return;const cols=focusedColumn?columns.filter(c=>c.id===focusedColumn):columns;const root=$('board-grid'),outer=$('board');outer.classList.toggle('focus',Boolean(focusedColumn));root.style.setProperty('--cols',String(Math.max(1,cols.length)));root.replaceChildren();if(!rows.length||!columns.length){const empty=el('div','empty','Den här tavlan är tom. Öppna Tavlans inställningar och lägg till minst en rad och en kolumn för att börja.');root.append(empty);$('button-add-card').disabled=true;$('view-all').hidden=true;$('view-label').textContent='Tom tavla';return;}$('button-add-card').disabled=false;root.append(el('div','corner'));for(const c of cols){const h=el('div','col-head',c.label);h.title='Visa denna kolumn större';h.onclick=()=>{if(window.matchMedia('(max-width:650px)').matches&&!focusedColumn){focusedColumn=c.id;renderBoard();}};root.append(h);}for(const r of rows){root.append(el('div','row-head',r.label));for(const c of cols){const zone=el('section','cell');zone.dataset.row=r.id;zone.dataset.column=c.id;const arr=cards.filter(x=>x.row_id===r.id&&x.column_id===c.id).sort((a,b)=>a.sort_order-b.sort_order);for(let i=0;i<arr.length;i++)zone.append(cardElement(arr[i],arr,i));const add=el('button','add','＋');add.title='Lägg till här';add.onclick=()=>editCard(null,r.id,c.id);zone.append(add);zone.ondragover=e=>{if(drag){e.preventDefault();zone.classList.add('over');}};zone.ondragleave=()=>zone.classList.remove('over');zone.ondrop=e=>{if(drag){e.preventDefault();zone.classList.remove('over');moveCard(drag,r.id,c.id);drag=null;}};root.append(zone);}}$('view-all').hidden=!focusedColumn;$('view-label').textContent=focusedColumn?(columns.find(c=>c.id===focusedColumn)?.label||'Kolumn'):'Tryck på en kolumnrubrik för större vy';}
$('view-all').onclick=()=>{focusedColumn=null;renderBoard();};
async function mutation(action){if(busy)return;busy=true;try{await action();await reloadBoard();info('Sparat ✓');}catch(e){alert('Kunde inte spara: '+err(e));await reloadBoard().catch(()=>{});}finally{busy=false;}}
async function moveCard(id,rid,cid,beforeId){const card=cards.find(c=>c.id===id);if(!card)return;const arr=cards.filter(c=>c.row_id===rid&&c.column_id===cid&&c.id!==id).sort((a,b)=>a.sort_order-b.sort_order);let at=beforeId?arr.findIndex(c=>c.id===beforeId):arr.length;if(at<0)at=arr.length;const lo=at>0?arr[at-1].sort_order:null,hi=at<arr.length?arr[at].sort_order:null;let order=lo==null?(hi==null?1000:hi-1000):(hi==null?lo+1000:Math.floor((hi+lo)/2));if(lo!=null&&hi!=null&&hi-lo<2){alert('Sorteringsutrymmet i denna kolumn är slut. Flytta annat jobb eller kontakta utvecklaren.');return;}await mutation(async()=>{const data=await req(sb.from('pd_cards').update({row_id:rid,column_id:cid,sort_order:order}).eq('id',id).eq('updated_at',card.updated_at).select('id'));if(!data.length)throw Error('En annan användare hann ändra lappen.');});}
function reorderCard(c,dir){const arr=cards.filter(x=>x.row_id===c.row_id&&x.column_id===c.column_id).sort((a,b)=>a.sort_order-b.sort_order);const i=arr.findIndex(x=>x.id===c.id);if(dir<0&&i>0)moveCard(c.id,c.row_id,c.column_id,arr[i-1].id);else if(dir>0&&i<arr.length-1)moveCard(c.id,c.row_id,c.column_id,arr[i+1+1]?.id);}
function fillSelect(select,list,selected){select.replaceChildren();for(const x of list){const opt=el('option','',x.label);opt.value=x.id;select.append(opt);}if(selected)select.value=selected;}
function editCard(id,rid,cid){if(!rows.length||!columns.length){alert('Lägg först till minst en rad och en kolumn i tavlans inställningar.');return;}const card=cards.find(c=>c.id===id);editingId=id;const rr=$('card-row'),cc=$('card-column');fillSelect(rr,rows,card?.row_id||rid||rows[0]?.id);fillSelect(cc,columns,card?.column_id||cid||columns[0]?.id);$('card-title').value=card?.title||'';$('card-dialog-title').textContent=card?'Visa / redigera lapp':'Ny lapp';$('card-delete').hidden=!card;const target=$('card-fields');target.replaceChildren();for(const f of fields){const label=el('label','control');label.append(el('span','',f.name));let input;if(f.kind==='select'){input=el('select');const blank=el('option','','Ej vald');blank.value='';input.append(blank);for(const o of f.options||[]){const n=el('option','',o.label);n.value=o.label;input.append(n);}}else{input=el(f.kind==='textarea'?'textarea':'input');if(f.kind!=='textarea')input.type='text';input.maxLength=1000;}input.dataset.fieldId=f.id;input.value=card?.values_json?.[f.id]||'';if(f.kind==='textarea')setupTextArea(input);label.append(input);target.append(label);}openDialogQuietly($('card-dialog'));rememberForm('card-dialog');}
$('button-add-card').onclick=()=>editCard(null);
$('card-dialog').addEventListener('cancel',e=>{if(!confirmDiscard('card-dialog'))e.preventDefault();});
$('card-cancel').onclick=()=>{if(confirmDiscard('card-dialog'))$('card-dialog').close();};
$('card-form').onsubmit=async e=>{e.preventDefault();if(!e.submitter||e.submitter.tagName!=='BUTTON')return;const title=$('card-title').value.trim();if(!title)return;const old=cards.find(c=>c.id===editingId);const vals={};for(const x of $('card-fields').querySelectorAll('[data-field-id]'))vals[x.dataset.fieldId]=x.value.trim();const input={board_id:board.id,row_id:$('card-row').value,column_id:$('card-column').value,title,values_json:vals,sort_order:old?.sort_order??pos(cards.filter(c=>c.row_id===$('card-row').value&&c.column_id===$('card-column').value))};$('card-dialog').close();await mutation(async()=>{if(old){const data=await req(sb.from('pd_cards').update(input).eq('id',old.id).eq('updated_at',old.updated_at).select('id'));if(!data.length)throw Error('Lappen ändrades samtidigt av någon annan.');}else await req(sb.from('pd_cards').insert(input));});};
$('card-delete').onclick=async()=>{const old=cards.find(c=>c.id===editingId);if(!old||!confirm('Vill du verkligen ta bort denna lapp?'))return;$('card-dialog').close();await mutation(async()=>{await req(sb.from('pd_cards').delete().eq('id',old.id));});};
$('button-refresh').onclick=()=>reloadBoard().catch(e=>alert(err(e)));
function subscribe(){if(channel)sb.removeChannel(channel);channel=sb.channel('pd-'+board.id).on('postgres_changes',{event:'*',schema:'public',table:'pd_cards',filter:'board_id=eq.'+board.id},()=>{if(!$('card-dialog').open&&!busy)reloadBoard().catch(()=>{});else info('En annan användare har ändrat tavlan – uppdatera efter redigering');}).subscribe();}
// Redigerare för antal rader, kolumner och fält; arbetar först i lokalt formulär.
let draft=null;
function labelEditor(container,items,limit){const root=$(container);root.replaceChildren();items.forEach((item,i)=>{const div=el('div','item-head');const inp=el('input');inp.value=item.label;inp.placeholder='Ange namn';inp.setAttribute('aria-label','Namn');inp.oninput=()=>{item.label=inp.value;};const rem=el('button','','×');rem.type='button';rem.disabled=false;rem.onclick=()=>{if(!confirm('Ta bort raden/kolumnen? Innehåll måste först flyttas bort.'))return;items.splice(i,1);renderDraft();};div.append(inp,rem);root.append(div);});}
function renderDraft(){labelEditor('rows-editor',draft.rows,20);labelEditor('columns-editor',draft.cols,12);const root=$('fields-editor');root.replaceChildren();draft.fields.forEach((f,i)=>{const item=el('div','item');const line=el('div','item-head');const inp=el('input');inp.value=f.name;inp.placeholder='Ange fältnamn';inp.setAttribute('aria-label','Fältnamn');inp.oninput=()=>f.name=inp.value;const del=el('button','','×');del.type='button';del.onclick=()=>{if(!confirm('Ta bort fältet och dess information från tavlan?'))return;draft.fields.splice(i,1);renderDraft();};line.append(inp,del);item.append(line);const type=el('select');for(const [v,name] of [['text','Text'],['textarea','Lång text'],['select','Rullista']]){const op=el('option','',name);op.value=v;type.append(op);}type.value=f.kind;type.onchange=()=>{f.kind=type.value;renderDraft();};const typeLine=el('label','control');typeLine.append(el('span','','Typ'),type);item.append(typeLine);const p=el('label','mini');const check=el('input');check.type='checkbox';check.checked=!!f.is_primary;check.onchange=()=>{if(check.checked&&draft.fields.filter(x=>x.is_primary).length>=2){check.checked=false;alert('Max två extra primära fält. Rubriken är alltid synlig.');return;}f.is_primary=check.checked;};p.append(check,document.createTextNode(' Primärt fält (synligt på lappen)'));item.append(p);const color=el('label','mini');const c=el('input');c.type='radio';c.name='colorfield';c.checked=!!f.color_source;c.onchange=()=>{draft.fields.forEach(x=>x.color_source=x===f);};color.append(c,document.createTextNode(' Styr lappens färg'));item.append(color);
if(f.kind==='select'){const list=el('div','settings-list');for(let j=0;j<(f.options||[]).length;j++){const opt=f.options[j];const row=el('div','item-head');const name=el('input');name.value=opt.label;name.placeholder='Alternativ';name.oninput=()=>opt.label=name.value;const swatch=el('input');swatch.type='color';swatch.className='swatch';swatch.value=/^#[0-9a-f]{6}$/i.test(opt.color)?opt.color:'#d8eefa';swatch.title='Alternativets färg';swatch.oninput=()=>opt.color=swatch.value;const remove=el('button','','×');remove.type='button';remove.onclick=()=>{f.options.splice(j,1);renderDraft();};row.append(name,swatch,remove);list.append(row);}const add=el('button','','＋ Alternativ');add.type='button';add.onclick=()=>{f.options.push({label:'Nytt alternativ',color:'#dde6ef'});renderDraft();};item.append(list,add);}root.append(item);});}
$('add-row').onclick=()=>{if(draft.rows.length>=20)return;draft.rows.push({label:''});renderDraft();$('rows-editor').lastElementChild?.querySelector('input')?.focus();};
$('add-column').onclick=()=>{if(draft.cols.length>=12)return;draft.cols.push({label:''});renderDraft();$('columns-editor').lastElementChild?.querySelector('input')?.focus();};
$('add-field').onclick=()=>{if(draft.fields.length>=20)return;draft.fields.push({name:'',kind:'text',is_primary:false,color_source:false,options:[]});renderDraft();$('fields-editor').lastElementChild?.querySelector('input')?.focus();};
$('board-dialog').addEventListener('cancel',e=>{if(!confirmDiscard('board-dialog'))e.preventDefault();});
$('board-cancel').onclick=()=>{if(confirmDiscard('board-dialog'))$('board-dialog').close();};
$('button-settings').onclick=()=>editBoard(board);
function editBoard(b){editingBoard=Boolean(b);draft={rows:b?rows.map(x=>({...x})):[],cols:b?columns.map(x=>({...x})):[],fields:b?fields.map(x=>({...x,options:JSON.parse(JSON.stringify(x.options||[]))})):[]};$('board-name').value=b?.name||'';$('board-dialog-title').textContent=b?'Anpassa tavla':'Skapa tavla';renderDraft();openDialogQuietly($('board-dialog'));rememberForm('board-dialog');}
$('board-form').onsubmit=async e=>{e.preventDefault();if(!e.submitter||e.submitter.tagName!=='BUTTON')return;if(busy)return;const name=$('board-name').value.trim();if(!name)return;for(const a of [draft.rows,draft.cols,draft.fields]){if(a.some(x=>!String(x.label??x.name).trim())){alert('Alla rader, kolumner och fält behöver ett namn.');return;}}if(draft.fields.filter(f=>f.is_primary).length>2){alert('Max två primära fält.');return;}if(draft.fields.filter(f=>f.color_source).length>1){alert('Högst ett färgstyrande fält.');return;}
$('board-dialog').close();busy=true;try{let bid;if(editingBoard){bid=board.id;await req(sb.from('pd_boards').update({name}).eq('id',bid));}else{const b=await req(sb.from('pd_boards').insert({workspace_id:workspace.id,name}).select().single());bid=b.id;}
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
async function duplicateBoard(id){const original=boards.find(b=>b.id===id);const newName=await ask('Duplicera tavla','Alla rader, kolumner, fält och lappar kopieras. Originalet påverkas inte.','Nytt namn',original.name+' (kopia)');if(!newName)return;try{const [r,c,f,n]=await Promise.all(['pd_rows','pd_columns','pd_fields','pd_cards'].map(t=>req(sb.from(t).select('*').eq('board_id',id).order('sort_order'))));const newBoard=await req(sb.from('pd_boards').insert({workspace_id:workspace.id,name:newName}).select().single());const rowMap=new Map(),colMap=new Map(),fieldMap=new Map();for(const [table,items,map] of [['pd_rows',r,rowMap],['pd_columns',c,colMap],['pd_fields',f,fieldMap]])for(const x of items){const payload={board_id:newBoard.id,sort_order:x.sort_order};if(table==='pd_fields')Object.assign(payload,{name:x.name,kind:x.kind,is_primary:x.is_primary,color_source:x.color_source,options:x.options});else payload.label=x.label;const newer=await req(sb.from(table).insert(payload).select().single());map.set(x.id,newer.id);}for(const x of n){const values={};for(const [key,val] of Object.entries(x.values_json||{}))if(fieldMap.has(key))values[fieldMap.get(key)]=val;await req(sb.from('pd_cards').insert({board_id:newBoard.id,row_id:rowMap.get(x.row_id),column_id:colMap.get(x.column_id),title:x.title,values_json:values,sort_order:x.sort_order}));}await openWorkspace(workspace.id);info('Tavlan kopierad ✓');}catch(e){alert('Kopieringen kunde inte slutföras: '+err(e));}};
async function deleteBoard(id){
 const target=boards.find(b=>b.id===id);if(!target)return;
 if(!confirm('Ta bort tavlan "'+target.name+'" och alla dess lappar? Detta går inte att ångra.'))return;
 try{await req(sb.rpc('pd_delete_board',{target_board:id}));if(board?.id===id){board=null;rows=[];columns=[];fields=[];cards=[];}await openWorkspace(workspace.id);info('Tavlan borttagen ✓');}
 catch(e){alert('Kunde inte ta bort tavlan: '+err(e));}
}
$('button-logout').onclick=async()=>{if(channel){await sb.removeChannel(channel);channel=null;}await sb.auth.signOut();user=null;showOnly('auth');$('button-logout').hidden=true;info('Utloggad');};
$('button-reconfig').onclick=()=>showOnly('config');
async function establish(){const {data,error}=await sb.auth.getSession();if(error)throw error;user=data.session?.user||null;if(!user){$('button-logout').hidden=true;showOnly('auth');return;}$('button-logout').hidden=false;await home();}
async function connect(url,key){if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url))throw Error('Kontrollera Project URL');if(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))throw Error('Använd endast publishable/anon-nyckel');sb=createClient(url.replace(/\/$/,''),key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});localStorage.setItem(CONN,JSON.stringify({url,key}));await establish();}
$('config-form').onsubmit=async e=>{e.preventDefault();try{await connect($('url').value.trim(),$('key').value.trim());}catch(e){alert(err(e));}};
$('auth-form').onsubmit=async e=>{e.preventDefault();try{const {error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';await establish();}catch(e){alert('Inloggning misslyckades: '+err(e));}};
$('button-register').onclick=async()=>{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6){alert('Fyll i e-post och lösenord (minst sex tecken).');return;}try{const {error}=await sb.auth.signUp({email,password});if(error)throw error;alert('Registreringen mottagen. Bekräfta via e-post om Supabase begär det, och logga sedan in.');}catch(e){alert(err(e));}};
// Pull-to-refresh, endast i mobilens översikt vid sidans topp.
let startY=null,pull=0;
const area=$('board-area');area.addEventListener('touchstart',e=>{if(window.matchMedia('(max-width:650px)').matches&&window.scrollY<20&&e.touches.length===1&&!e.target.closest('.note,button,select,input')){startY=e.touches[0].clientY;pull=0;}},{passive:true});
area.addEventListener('touchmove',e=>{if(startY===null||e.touches.length!==1)return;pull=Math.max(0,Math.min(90,e.touches[0].clientY-startY));$('pull-indicator').style.height=(pull*.55)+'px';$('pull-indicator').textContent=pull>65?'Släpp för att uppdatera':'↻ Dra ned för att uppdatera';},{passive:true});
area.addEventListener('touchend',()=>{if(startY!==null&&pull>65)reloadBoard().catch(e=>info(err(e)));startY=null;pull=0;$('pull-indicator').style.height='0';},{passive:true});
try{const saved=JSON.parse(localStorage.getItem(CONN)||'null');if(saved?.url&&saved?.key){$('url').value=saved.url;$('key').value=saved.key;connect(saved.url,saved.key).catch(e=>{showOnly('config');info(err(e));});}else{showOnly('config');$('url').value='https://huxqiwgvsjedjlaaztif.supabase.co';}}catch(e){showOnly('config');info(err(e));}
