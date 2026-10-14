import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const urls = new Map();
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let code = stripTypeScriptTypes(readFileSync(new URL('../src/trajectory/'+name+'.ts', import.meta.url), 'utf8'));
  for (const match of code.matchAll(/from '(\.\/([^']+))'/g)) code = code.replaceAll("'"+match[1]+"'", JSON.stringify(moduleUrl(match[2])));
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  urls.set(name, url); return url;
}
const { buildChat } = await import(moduleUrl('chat'));
const { buildSmartContext, runSmartChat } = await import(moduleUrl('smartContext'));
const { streamChat } = await import(moduleUrl('providers'));
const payload = 'QklOQVJZ'.repeat(20000);
const uri = 'data:image/png;base64,'+payload;
const blocks = [
  {type:'input_image',image_url:uri},
  {type:'image',source:{type:'base64',media_type:'image/png',data:payload}},
  {type:'image',mimeType:'image/jpeg',data:payload},
  {type:'image_url',image_url:{url:'https://private.invalid/image.png'}},
];
const text = 'TEXT_BEFORE\n' + blocks.map(b=>JSON.stringify(b)).join('\n') + '\n' + JSON.stringify({wrapped:JSON.stringify(blocks)}) + '\nTEXT_AFTER';
const entity = {id:'s0',title:'Checkpoint',summary:'A useful checkpoint',events:['E0'],snapshot:{code:'source'}};
const graph = {title:'Image run',scope:'source',notes:[],states:[entity],branches:[{id:'b0',state:'s0',title:'Inspect',summary:'Read reference',events:['E0'],status:'retained'}],
  actions:[{id:'a0',state:'s0',branch:'b0',actor:'main',behavior:'Explore',title:'Inspect reference',summary:'Read the reference',events:['E0']}],transitions:[],links:[],
  timeline:{timeline:[{id:'E0',kind:'user',actor:'main',text}],sources:[]}};
const original = JSON.stringify(graph);
const clean = value => { const text = JSON.stringify(value); assert(!text.includes(payload.slice(0,64)), 'No image bytes or Base64 text in context'); assert(!text.includes('private.invalid/image.png'), 'Typed image URLs are excluded'); };
for (const mode of ['prefix','current','nearby','run']) for (const compression of ['full','excerpts']) {
  const context = buildChat(graph, mode==='run'?null:'a0', 'why?', [], {mode,compression,inputTokens:4096});
  clean(context.messages); assert(!context.preview.blocked, 'Image bytes cannot exhaust the text budget');
  const sent = context.messages.at(-1).content;
  assert(sent.includes('TEXT_BEFORE') && sent.includes('TEXT_AFTER') && sent.includes('[[E0]]'));
  assert(sent.includes('Image omitted'));
}
const withImageSummary = structuredClone(graph);
withImageSummary.actions[0].summary = JSON.stringify(blocks[1]) + ' SUMMARY_AFTER';
const summaryPlan = buildSmartContext(withImageSummary,'a0','why?',[],{inputTokens:4096});
clean(summaryPlan.messages);
assert(summaryPlan.messages[0].content.includes('SUMMARY_AFTER'), 'Strip image payloads before summary clipping');
const smart = buildSmartContext(graph,'a0','why?',[],{inputTokens:4096});
assert(smart.catalog[0].estimatedTokens < 1000, 'Smart selection budgets use image-free text');
const calls=[];
await runSmartChat({provider:'openai',baseUrl:'https://example.invalid/v1',apiKey:'fake',model:'mock',remember:false},smart,()=>{},new AbortController().signal,{transport:async(s,system,messages,onText)=>{
  calls.push({system,messages}); onText(calls.length===1?'{"eventIds":["E0"]}':'Text answer');
}});
assert.equal(calls.length,2); clean(calls);
assert(calls[1].messages[0].content.includes('TEXT_AFTER'));
assert.equal(JSON.stringify(graph),original,'Chat sanitization leaves imported images and source text intact');
const oldFetch=globalThis.fetch;
try {
  for(const provider of ['openai','anthropic']) {
    globalThis.fetch=async(url,init)=>{ const body=JSON.parse(init.body);clean(body); assert(JSON.stringify(body).includes('TEXT_BEFORE')); return new Response(JSON.stringify(provider==='anthropic'?{content:[{type:'text',text:'ok'}]}:{choices:[{message:{content:'ok'}}]}),{headers:{'content-type':'application/json'}}); };
    await streamChat({provider,baseUrl:'https://example.invalid/v1',apiKey:'fake',model:'mock',remember:false}, 'System '+JSON.stringify(blocks[0]),[{role:'user',content:text}],()=>{},new AbortController().signal);
  }
} finally {globalThis.fetch=oldFetch;}
console.log('PASS: all direct modes, smart selection and answer, text budgets and both provider payloads exclude images without mutating the trajectory (mock requests only)');
