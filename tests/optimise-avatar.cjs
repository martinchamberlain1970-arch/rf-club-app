const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const sharp = require('sharp');
function load(path, overrides = {}) {
  const m = new Module(path, module); m.filename = path; m.paths = module.paths;
  const base = m.require.bind(m); m.require = id => id in overrides ? overrides[id] : base(id);
  m._compile(ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,path);
  return m.exports;
}
const helper = load('src/lib/optimise-avatar.ts');
test('large photo is resized, metadata removed, aspect preserved and original untouched', async () => {
 const input = await sharp({create:{width:4032,height:3024,channels:3,background:'#437b90'}}).jpeg().withMetadata().toBuffer();
 const original = Buffer.from(input); const output = await helper.optimiseAvatar(input); const meta = await sharp(output).metadata();
 assert.equal(meta.format,'webp'); assert.equal(meta.width,768); assert.equal(meta.height,576); assert.equal(meta.exif,undefined); assert.deepEqual(input,original);
});
test('orientation is applied and smaller images are not enlarged',async()=>{
 const input=await sharp({create:{width:100,height:200,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const meta=await sharp(await helper.optimiseAvatar(input)).metadata(); assert.equal(meta.width,200); assert.equal(meta.height,100);
});
test('invalid, oversized and vector uploads fail safely; animation is preserved',async()=>{
 for(const bytes of [Buffer.from('bad'),Buffer.alloc(0),Buffer.alloc(helper.MAX_AVATAR_BYTES+1),Buffer.from('<svg width="10" height="10"></svg>')]) await assert.rejects(helper.optimiseAvatar(bytes));
 const gif=await sharp(Buffer.from([255,0,0,255,0,0,255,0,0,255,0,0,0,0,255,0,0,255,0,0,255,0,0,255]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).gif({loop:0,delay:[100,100]}).toBuffer();
 const animated=await sharp(await helper.optimiseAvatar(gif),{animated:true}).metadata(); assert.equal(animated.pages,2); assert.equal(animated.pageHeight,2);
});
process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';delete process.env.SUPER_ADMIN_EMAIL;
function route(role='owner',missing=false) {
 const updates=[];const uploads=[];
 const admin={auth:{getUser:async()=>({data:{user:{id:'owner',user_metadata:{role:'owner'}}}})},from(table){
   const filters=[];let value;
   const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){value=v;return q},maybeSingle:async()=>({data:{role}}),then(resolve){updates.push({table,value,filters});return Promise.resolve({data:[],error:null}).then(resolve)}};return q;
 },storage:{from(){return {info:async()=>missing?{error:Error('missing')}:{data:{}},getPublicUrl:p=>({data:{publicUrl:'https://example.supabase.co/storage/v1/object/public/avatars/'+p}}),upload:async(...args)=>{uploads.push(args);return {data:{}}}}}}};
 return {updates,uploads,handler:load('src/app/api/admin/photo-optimisation/route.ts',{'@supabase/supabase-js':{createClient:()=>admin},'@/lib/optimise-avatar':helper})};
}
const req=(action,path='avatars/example.jpeg')=>new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer test','content-type':'application/json'},body:JSON.stringify({action,path})});
test('migration is owner-only, ignoring self-claimed metadata roles',async()=>{
 const r=route('player');assert.equal((await r.handler.POST(req('activate'))).status,403);assert.equal(r.updates.length,0);
});
test('activation and rollback use exact old URL and pending-only requests',async()=>{
 const r=route();assert.equal((await r.handler.POST(req('activate'))).status,200);
 assert.ok(r.updates[0].value.avatar_url.endsWith(helper.AVATAR_SUFFIX));assert.deepEqual(r.updates[1].filters[1],['status','pending']);
 assert.equal((await r.handler.POST(req('rollback'))).status,200);assert.ok(!r.updates[2].value.avatar_url.endsWith(helper.AVATAR_SUFFIX));assert.ok(r.updates[2].filters[0][1].endsWith(helper.AVATAR_SUFFIX));
});
test('missing destination or path traversal cannot change references',async()=>{
 const r=route('owner',true);assert.equal((await r.handler.POST(req('activate'))).status,400);assert.equal(r.updates.length,0);
 assert.equal((await r.handler.POST(req('prepare','avatars/../secret'))).status,400);
});
test('future upload preserves original bytes, publishes compressed copy and uses year-long cache',async()=>{
 global.File=require('node:buffer').File;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
 const input=await sharp({create:{width:1600,height:1200,channels:3,background:'blue'}}).jpeg().toBuffer();
 const uploads=[];const writes=[];
 const admin={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){let value;const q={select(){return q},eq(){return q},update(v){value=v;return q},maybeSingle:async()=>({data:table==='app_users'?{id:'owner',role:'owner'}:{id:'player'}}),then(resolve){writes.push(value);return Promise.resolve({error:null}).then(resolve)}};return q},storage:{from(){return {upload:async(path,bytes,options)=>{uploads.push({path,bytes,options});return {error:null}},getPublicUrl:path=>({data:{publicUrl:'https://example/'+path}})}}}};
 const upload=load('src/app/api/player/avatar/route.ts',{'@supabase/supabase-js':{createClient:()=>admin},'@/lib/optimise-avatar':helper});
 const file=new File([input],'photo.jpg',{type:'image/jpeg'});
 const response=await upload.POST({headers:new Headers({authorization:'Bearer test'}),formData:async()=>({get:key=>key==='playerId'?'player':file})});
 assert.equal(response.status,200);assert.equal(uploads.length,2);assert.deepEqual(Buffer.from(uploads[0].bytes),input);assert.equal(uploads[1].path,uploads[0].path+helper.AVATAR_SUFFIX);assert.equal(uploads[1].options.cacheControl,'31536000');assert.equal(uploads[1].options.upsert,false);assert.ok(writes[0].avatar_url.endsWith(helper.AVATAR_SUFFIX));
});
test('club uploads enforce own-profile access, block minors and retain admin versus member approvals', async()=>{
 global.File=require('node:buffer').File;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
 const input=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).jpeg().toBuffer();
 for(const scenario of [
  {role:'player',linked:'other',age:'18_plus',status:403},
  {role:'owner',linked:'player',age:'under_18',status:403},
  {role:'admin',linked:null,age:'18_plus',status:200,mode:'direct'},
  {role:'player',linked:'player',age:'18_plus',status:200,mode:'pending'},
  {role:'player',linked:null,claimed:'user',age:'18_plus',status:200,mode:'pending'},
 ]) {
  const uploads=[],writes=[];
  const admin={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from(table){let value;const q={select(){return q},eq(){return q},update(v){value=v;return q},insert(v){value=v;return q},maybeSingle:async()=>({data:table==='app_users'?{id:'user',role:scenario.role,linked_player_id:scenario.linked}:{id:'player',age_band:scenario.age,claimed_by:scenario.claimed}}),then(resolve){writes.push({table,value});return Promise.resolve({error:null}).then(resolve)}};return q},storage:{from(){return {upload:async(...args)=>{uploads.push(args);return {error:null}},getPublicUrl:path=>({data:{publicUrl:'https://example/'+path}})}}}};
  const route=load('src/app/api/player/avatar/route.ts',{'@supabase/supabase-js':{createClient:()=>admin},'@/lib/optimise-avatar':helper});
  const result=await route.POST({headers:new Headers({authorization:'Bearer test'}),formData:async()=>({get:key=>key==='playerId'?'player':new File([input],'photo.jpg',{type:'image/jpeg'})})});
  assert.equal(result.status,scenario.status,JSON.stringify(scenario));
  if(scenario.status===403){assert.equal(uploads.length,0);assert.equal(writes.length,0)}
  else {assert.equal((await result.json()).mode,scenario.mode);assert.equal(writes[0].table,scenario.mode==='pending'?'player_update_requests':'players');if(scenario.mode==='pending')assert.equal(writes[0].value.status,'pending')}
 }
});
