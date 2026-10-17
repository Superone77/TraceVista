import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {exampleCatalog,exampleFile,exampleLibraryRoot} from './example-library.mjs';

const root=exampleLibraryRoot();
const catalog=exampleCatalog(root);
assert.equal(new Set(catalog.map(d=>d.id)).size,catalog.length,'Example IDs are unique');
assert.deepEqual(catalog.map(d=>d.id),['pi-agent-lora','posttrainbench-fable5-aime','inferencebench-serving-recovery','swe-rebench-kafka-retry','literesearcher-affiliations','codex-garden-animation'],'The library contains the six approved examples, with Pi Agent first');
assert.deepEqual(readdirSync(join(root,'examples')).sort(),['index.json',...catalog.map(d=>d.file)].sort(),'The library contains no unlisted exports');
for(const d of catalog){
 const graph=JSON.parse(readFileSync(exampleFile(d.file,root),'utf8'));
 assert.equal(graph.format,'coding-agent-state-trajectory',`${d.id}: supported export format`);
 if(d.thumbnail){
  assert(/^[a-zA-Z0-9_-]+\.(?:webp|png|jpe?g)$/.test(d.thumbnail),`${d.id}: safe thumbnail filename`);
  assert(statSync(join(root,'example-thumbnails',d.thumbnail)).isFile(),`${d.id}: thumbnail exists`);
 }
}
console.log(`PASS: external example catalog and ${catalog.length} complete JSON exports`);
