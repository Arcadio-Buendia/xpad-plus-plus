const GLib=imports.gi.GLib;
const read=p=>imports.byteArray.toString(GLib.file_get_contents(p)[1]);
const loop=new GLib.MainLoop(null,false);
const source=read('xpad.js');
let slots=[], index=0, effects=[], listeners={}, saved=null, initial='{}', failLoad=false;
globalThis.window=globalThis;
globalThis.innerWidth=1000; globalThis.innerHeight=800;
globalThis.crypto={randomUUID:()=>String(Math.random())};
globalThis.localStorage={getItem:()=>{if(failLoad)throw Error('unreadable');return initial;},setItem:(k,v)=>saved=JSON.parse(v)};
globalThis.addEventListener=(name,fn)=>listeners[name]=fn;
globalThis.removeEventListener=()=>{};
globalThis.document={getElementById:()=>({})};
globalThis.React={
  useState:initial=>{const n=index++;if(!(n in slots))slots[n]=initial;return [slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v];},
  useRef:initial=>{const n=index++;if(!(n in slots))slots[n]={current:initial};return slots[n];},
  useEffect:fn=>{const n=index++;if(!(n in slots)){slots[n]=true;effects.push(fn);}},
  createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}), Fragment:'fragment'
};
globalThis.ReactDOM={createRoot:()=>({render:()=>{}})};
function assert(v,message){if(!v)throw Error(message);print('PASS '+message);}
(0,eval)(source+`\n globalThis.renderPadApp=()=>Xpad();`);
function render(){index=0;return renderPadApp();}
function find(el,predicate){if(!el || typeof el!=='object')return null;if(predicate(el))return el;for(const child of el.children || []){const hit=find(child,predicate);if(hit)return hit;}return null;}
async function run(){
  render();for(const fn of effects.splice(0))fn();await Promise.resolve();
  let tree=render();let pad=find(tree,e=>e.props.note);
  assert(pad && pad.props.note.body==='', 'fresh store starts with one blank note');
  pad.props.patch({body:'Remember me',color:'green',padPaper:'#ddead1',padFont:'Serif Example',padFontSize:22,padInk:'#123456',x:350,y:250,w:310,h:280});
  assert(saved.notes[0].body==='Remember me' && saved.notes[0].x===350 && saved.notes[0].color==='green','text, color, position and size persist');
  pad=find(render(),e=>e.props.note);pad.props.add();
  assert(saved.notes.length===2 && saved.notes[1].z>saved.notes[0].z,'new notes are added above existing notes');
  for(const key of ['w','h','color','padPaper','padFont','padFontSize','padInk'])assert(saved.notes[1][key]===saved.notes[0][key], 'child inherits '+key);
  assert(saved.notes[1].body==='' && saved.notes[1].id!==saved.notes[0].id && saved.notes[1].x===386 && saved.notes[1].y===286,'child is blank with its own identity and offset position');
  pad=find(render(),e=>e.props.note);pad.props.close();
  tree=render();assert(saved.notes[0].padClosed && !find(tree,e=>e.props.note?.id===saved.notes[0].id),'closing hides a saved note');
  listeners.keydown({ctrlKey:true,key:'n',preventDefault(){}});
  assert(saved.notes.length===3,'Ctrl+N creates a note');
  assert(saved.notes[2].color==='yellow' && saved.notes[2].padFont==='Kalam' && saved.notes[2].w===280,'standalone notes retain default appearance');
  pad=find(render(),e=>e.props.note);pad.props.remove();tree=render();
  assert(saved.notes.length===3 && find(tree,e=>e.props.role==='alertdialog'),'deletion requires confirmation');
  find(tree,e=>e.type==='button' && e.children[0]==='Delete').props.onClick();
  assert(saved.notes.length===2,'confirmed deletion removes only the selected note');
  initial=JSON.stringify(saved);slots=[];effects=[];render();for(const fn of effects.splice(0))fn();await Promise.resolve();
  assert(find(render(),e=>e.props.note)?.props.note.id===saved.notes[1].id,'saved closed state and remaining notes survive reopening');
  saved=null;failLoad=true;slots=[];effects=[];render();for(const fn of effects.splice(0))fn();await Promise.resolve();
  tree=render();assert(find(tree,e=>e.props.className==='load-message').children[0].includes('Could not open') && saved===null,'failed loading does not overwrite notes');
}
run().then(()=>loop.quit()).catch(err=>{printerr(err.stack);imports.system.exit(1);});loop.run();
