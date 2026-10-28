import { test } from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../note-geometry.js';
const { overlaps, freePosition, settleNotes, moveNote, resizeNote } = geometry;
const rect = (id,x,y,w=180,h=140) => ({id,x,y,w,h});
const clear = notes => {
  for(let i=0;i<notes.length;i++)for(let j=i+1;j<notes.length;j++)
    if(!notes[i].padClosed && !notes[j].padClosed)assert.equal(overlaps(notes[i],notes[j]),false,`${notes[i].id} overlaps ${notes[j].id}`);
};

test('dragging stops exactly at contact, including a fast drag beyond an obstacle',()=>{
  const note=rect('a',0,0), wall=rect('b',300,0);
  assert.deepEqual(moveNote(note,{x:900,y:0},[note,wall]),{x:120,y:0});
  const touching={...note,x:120};
  assert.deepEqual(moveNote(touching,{x:170,y:0},[touching,wall]),{x:120,y:0});
  assert.deepEqual(moveNote(touching,{x:50,y:0},[touching,wall]),{x:50,y:0});
});

test('collisions work from left, right, above and below',()=>{
  const wall=rect('wall',300,300);
  for(const [start,target,expected] of [
    [[0,300],[900,300],[120,300]], [[700,300],[0,300],[480,300]],
    [[300,0],[300,900],[300,160]], [[300,700],[300,0],[300,440]],
  ]){
    const note=rect('moving',...start);
    assert.deepEqual(moveNote(note,{x:target[0],y:target[1]},[note,wall]),{x:expected[0],y:expected[1]});
  }
});

test('diagonal dragging slides along an edge, stops at corners, and permits tangent motion',()=>{
  const note=rect('a',0,0), wall=rect('wall',300,0,180,800);
  assert.deepEqual(moveNote(note,{x:400,y:300},[note,wall]),{x:120,y:300});
  const floor=rect('floor',0,400,800,140);
  assert.deepEqual(moveNote(note,{x:400,y:500},[note,wall,floor]),{x:120,y:260});
  assert.deepEqual(moveNote({...note,x:120},{x:120,y:200},[note,wall]),{x:120,y:200});
});

test('a diagonal drag cannot tunnel through a small obstacle',()=>{
  const note=rect('a',0,0,180,140), wall=rect('b',300,300,180,140);
  const result=moveNote(note,{x:1000,y:1000},[note,wall]);
  assert.ok(result.x===120 || result.y===160);
  assert.equal(overlaps({...note,...result},wall),false);
});

test('resize is blocked by right and bottom neighbors, while shrinking stays possible',()=>{
  const note=rect('a',0,0), right=rect('b',300,0,180,800), bottom=rect('c',0,300,800,140);
  assert.deepEqual(resizeNote(note,{w:900,h:900},[note,right,bottom]),{w:300,h:300});
  assert.deepEqual(resizeNote({...note,w:300,h:300},{w:180,h:140},[note,right,bottom]),{w:180,h:140});
});

test('resizing diagonally near a corner never overlaps the neighbor',()=>{
  const note=rect('a',0,0), neighbor=rect('b',250,200);
  const size=resizeNote(note,{w:400,h:400},[note,neighbor]);
  assert.equal(overlaps({...note,...size},neighbor),false);
  assert.deepEqual(size,{w:400,h:200});
});

test('closed notes do not obstruct moving or resizing',()=>{
  const note=rect('a',0,0), closed={...rect('b',300,0),padClosed:true};
  assert.deepEqual(moveNote(note,{x:800,y:0},[note,closed]),{x:800,y:0});
  assert.deepEqual(resizeNote(note,{w:800,h:500},[note,closed]),{w:800,h:500});
});

test('new and restored notes find nearby free space; existing notes do not move',()=>{
  const a=rect('a',100,100), b=rect('b',100,100), c=rect('c',100,100);
  const settled=settleNotes([a,b,c]);
  assert.equal(settled[0],a);
  clear(settled);
  assert.equal(settleNotes(settled),settled);
  const position=freePosition(b,[a]);
  assert.equal(overlaps(position,a),false);
  const closed={...b,padClosed:true};
  assert.equal(settleNotes([a,closed])[1],closed);
});

test('seeded varied layouts stay disjoint after repeated large drags and resizes',()=>{
  let seed=1337;
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  let notes=settleNotes(Array.from({length:20},(_,i)=>rect(String(i),random()*1200,random()*800,180+random()*200,140+random()*160)));
  clear(notes);
  for(let step=0;step<500;step++){
    const i=Math.floor(random()*notes.length), note=notes[i];
    const change=step%2 ? moveNote(note,{x:random()*2000,y:random()*1500},notes)
      : resizeNote(note,{w:180+random()*600,h:140+random()*400},notes);
    notes=notes.map((n,j)=>i===j?{...n,...change}:n);
    clear(notes);
  }
});


test('restoring a note yields to already visible notes without changing array order',()=>{
  const closed={...rect('closed',0,0),padClosed:true}, active=rect('active',0,0);
  const restored=settleNotes([{...closed,padClosed:false},active],[closed,active]);
  assert.equal(restored[0].id,'closed');
  assert.equal(restored[1],active);
  clear(restored);
});

test('legacy notes without geometry receive usable finite positions and dimensions',()=>{
  const result=settleNotes([{id:'a',body:'Keep me'},rect('b',0,0)]);
  assert.equal(result[0].body,'Keep me');
  assert.ok(Number.isFinite(result[0].x) && result[0].w>0 && result[0].h>0);
  clear(result);
});
