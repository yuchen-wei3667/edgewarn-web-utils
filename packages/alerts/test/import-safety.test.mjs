import test from 'node:test';
test('fresh imports do not request data or touch browser globals',async()=>{
 const names=['fetch','window','document','navigator','localStorage','sessionStorage'];
 const descriptors=names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
 try {
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>{throw Error('import-time fetch')}});
  for(const name of names.slice(1))Object.defineProperty(globalThis,name,{configurable:true,get(){throw Error(name)}});
  await import('@edgewarn/web-utils/alerts');
  await import('@edgewarn/web-utils/alerts/nws');
 } finally {
  names.forEach((name,i)=>descriptors[i]?Object.defineProperty(globalThis,name,descriptors[i]):delete globalThis[name]);
 }
});
