import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {packLayout,crc32} from '../src/layout/package-layout.mts';
import {defaultProject} from '../src/layout/default-project.mts';
import {deployRoute,nextLayoutSlot} from '../src/api/deploy-api.mts';
import {aiRoute,previewCodeEdits} from '../src/api/ai-api.mts';
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
test('compact package has stable header, CRC and no JSON/parser requirement on device',()=>{
 const data=packLayout(defaultProject()),view=new DataView(data.buffer);
 assert.equal(new TextDecoder().decode(data.slice(0,4)),'OUI2');assert.equal(view.getUint32(4,true),data.length-16);
 assert.equal(view.getUint32(8,true),crc32(data.slice(16)));assert.equal(data[16],8);assert.ok(data.length<4096);
 assert.throws(()=>packLayout({...defaultProject(),enabled:false}));
});
test('USB updates target the inactive valid slot and preserve previous data',()=>{
 const slots=Buffer.alloc(65536,255),packet=packLayout(defaultProject());
 assert.deepEqual(nextLayoutSlot(slots),{address:'0x3e0000',generation:1});
 slots.set(packet);slots.writeUInt32LE(7,32764);
 assert.deepEqual(nextLayoutSlot(slots),{address:'0x3e8000',generation:8});
 slots.set(packet,32768);slots.writeUInt32LE(8,65532);
 assert.deepEqual(nextLayoutSlot(slots),{address:'0x3e0000',generation:9});
 slots[32768+20]^=1;
 assert.deepEqual(nextLayoutSlot(slots),{address:'0x3e8000',generation:8});
 assert.throws(()=>nextLayoutSlot(slots.subarray(0,20)),/不完整/);
});
test('deployment sends the current project directly as binary',async t=>{
 let received;const device=http.createServer(async(req,res)=>{if(req.url==='/ui/capabilities'){res.end(JSON.stringify({protocol:1,board:'ESP32-2432S028',maxPackageBytes:28672,revision:4}));return;}const chunks=[];for await(const chunk of req)chunks.push(chunk);received={body:Buffer.concat(chunks),headers:req.headers};res.writeHead(202);res.end('{"accepted":true}');});
 const address=await listen(device),server=http.createServer((req,res)=>deployRoute(req,res,new URL(req.url,'http://localhost'))),base=await listen(server);t.after(()=>{device.close();server.close();});
 const doc=defaultProject();doc.nodes[0].text='Changed on device';
 const result=await fetch(base+'/api/deploy/layout',{method:'POST',body:JSON.stringify({address,document:doc,token:'test-token'})});
 assert.equal(result.status,200);assert.equal((await result.json()).previousRevision,4);
 assert.deepEqual(received.body,Buffer.from(packLayout(doc)));assert.equal(received.headers.authorization,'Bearer test-token');assert.equal(received.headers['x-optimuse-studio'],'1');
});
test('independent AI tool loop reads source, handles split UTF8 and validates operations',async t=>{
 let calls=0;const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);assert.equal(req.headers.authorization,'Bearer memory-key');calls++;
 const message=calls===1?{role:'assistant',content:null,tool_calls:[{id:'source',type:'function',function:{name:'read_source',arguments:JSON.stringify({path:'tools/esp32-editor/src/layout/routes.mts'})}}]}:{role:'assistant',content:JSON.stringify({summary:'修改首页按钮',operations:[{op:'update',id:'home_apps',changes:{text:'Open'}}]})};
 if(calls===2)assert.equal(input.messages.at(-1).role,'tool');const data=Buffer.from(JSON.stringify({choices:[{message}]}));for(let i=0;i<data.length;i++)res.write(data.subarray(i,i+1));res.end();});
 const endpoint=await listen(upstream),server=http.createServer((req,res)=>aiRoute(req,res,new URL(req.url,'http://localhost'))),base=await listen(server);t.after(()=>{upstream.close();server.close();});
 const result=await fetch(base+'/api/ai/develop',{method:'POST',body:JSON.stringify({endpoint,model:'test',key:'memory-key',task:'修改按钮',context:{document:defaultProject()}})});
 assert.equal(result.status,200);const proposal=await result.json();assert.equal(proposal.summary,'修改首页按钮');assert.equal(proposal.operations[0].id,'home_apps');assert.equal(calls,2);
 await assert.rejects(previewCodeEdits([{path:'tools/esp32-editor/src/layout/routes.mts',revision:'stale',find:'anything',replace:''}]),/变化/);
});
