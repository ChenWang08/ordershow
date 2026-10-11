import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts-module.mjs';
const { trackH5Viewport } = loadModule('app/features/h5/h5-viewport.ts');
function events(values = {}) {
  const listeners = new Map();
  return Object.assign(values, {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); },
    get count() { return listeners.size; },
  });
}
test('keyboard resize and browser pan keep the shell within the visible viewport; rotation and dismissal restore it', () => {
  const viewport = events({ height: 852, offsetTop: 0, scale: 1 });
  const host = events({ visualViewport: viewport, innerHeight: 852 });
  const style = new Map();
  let compact = false;
  const doc = events({activeElement:{matches:()=>true}});
  const stop = trackH5Viewport({ownerDocument:doc,contains:()=>true, toggleAttribute(name,value) { if(name === 'data-compact-viewport') compact=value; }, style: {setProperty:(k,v)=>style.set(k,v)} }, host);
  for (const [height,top,event] of [[380,0,'resize'],[380,120,'scroll'],[230,30,'resize'],[393,0,'resize'],[852,0,'resize']]) {
    Object.assign(viewport, {height,offsetTop:top}); viewport.emit(event);
    assert.equal(style.get('--h5-viewport-height'), `${height}px`);
    assert.equal(style.get('--h5-viewport-top'), `${height < 772 ? top : 0}px`);
    assert.equal(compact, height < 360);
  }
  stop(); assert.equal(viewport.count,0); assert.equal(host.count,0); assert.equal(doc.count,0);
});
test('ordinary iPhone rubber-band offsets never move the page; keyboard dismissal resets compensation', () => {
  const viewport=events({height:852,offsetTop:0,scale:1});
  const host=events({visualViewport:viewport,innerHeight:852});
  const doc=events({activeElement:null}); const style=new Map();
  trackH5Viewport({ownerDocument:doc,contains:()=>true,toggleAttribute(){},style:{setProperty:(k,v)=>style.set(k,v)}},host);
  for(const offset of [-80,60,0]) {viewport.offsetTop=offset;viewport.emit('scroll');assert.equal(style.get('--h5-viewport-top'),'0px');}
  doc.activeElement={matches:()=>true};doc.emit('focusin');
  Object.assign(viewport,{height:380,offsetTop:100});viewport.emit('resize');
  assert.equal(style.get('--h5-viewport-top'),'100px');
  doc.activeElement=null;doc.emit('focusout');
  assert.equal(style.get('--h5-viewport-top'),'0px');
});
test('pinch zoom does not reflow the shell; reset and floating-point scale restore tracking', () => {
  const viewport = events({height:852,offsetTop:0,scale:1});
  const style = new Map();
  trackH5Viewport({toggleAttribute() {},style:{setProperty:(k,v)=>style.set(k,v)}},events({visualViewport:viewport,innerHeight:852}));
  Object.assign(viewport,{scale:2,height:426,offsetTop:150}); viewport.emit('resize');
  assert.equal(style.get('--h5-viewport-height'),'852px');
  assert.equal(style.get('--h5-viewport-top'),'0px');
  Object.assign(viewport,{scale:1.000001,height:360,offsetTop:0}); viewport.emit('resize');
  assert.equal(style.get('--h5-viewport-height'),'360px');
});
test('browsers without VisualViewport follow window resize', () => {
  const host=events({innerHeight:568}); const style=new Map();
  trackH5Viewport({toggleAttribute() {},style:{setProperty:(k,v)=>style.set(k,v)}},host);
  host.innerHeight=320;host.emit('resize');
  assert.equal(style.get('--h5-viewport-height'),'320px');
  assert.equal(style.get('--h5-viewport-top'),'0px');
});
