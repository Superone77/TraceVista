import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exampleLibraryRoot,exampleFile,exampleCatalog} from './example-library.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'tracevista example paths '));
const scan=dir=>spawnSync('python3',['scripts/check-example-secrets.py','--examples-dir',dir],{cwd:root,encoding:'utf8'});
try{
 const absent=join(temp,'absent');
 assert.throws(()=>exampleLibraryRoot(absent),/Example library not found/,'An explicit missing path never falls back to an installed library');
 assert.throws(()=>exampleLibraryRoot(''),/must name/);
 const missingScan=scan(absent);
 assert.equal(missingScan.status,2,'A missing library cannot produce a zero-file success');
 assert.match(missingScan.stderr,/Example library not found/);
 mkdirSync(join(temp,'examples'));
 writeFileSync(join(temp,'examples','index.json'),'[]');
 assert.throws(()=>exampleCatalog(temp),/at least one/);
 assert.equal(scan(temp).status,2,'An empty catalog is not a successful scan');
 writeFileSync(join(temp,'examples','index.json'),JSON.stringify([{id:'small',file:'small.agent-state.json'}]));
 assert.equal(scan(temp).status,2,'A missing listed export is not a successful scan');
 writeFileSync(join(temp,'examples','small.agent-state.json'),'{}');
 assert.equal(exampleLibraryRoot(temp),temp,'Paths with spaces resolve as one repository root');
 assert.equal(exampleFile('small.agent-state.json',temp),join(temp,'examples','small.agent-state.json'));
 for(const file of ['../private.agent-state.json','/absolute.agent-state.json','https://example.com/run.agent-state.json'])assert.throws(()=>exampleFile(file,temp),/Invalid example filename/);
 const clean=scan(temp);
 assert.equal(clean.status,0,clean.stderr);
 assert.deepEqual(JSON.parse(clean.stdout),{example_files_scanned:2,files_with_credential_patterns:[],local_path_findings:[],invalid_json_files:[]});
 const fakeCredential='sk-'+ 'a'.repeat(30);
 writeFileSync(join(temp,'examples','small.agent-state.json'),JSON.stringify({synthetic:fakeCredential}));
 const rejected=scan(temp);
 assert.equal(rejected.status,1,'A credential-pattern match fails the scan');
 assert.deepEqual(JSON.parse(rejected.stdout).files_with_credential_patterns,['examples/small.agent-state.json']);
 assert(!rejected.stdout.includes(fakeCredential)&&!rejected.stderr.includes(fakeCredential),'The scanner reports paths without printing matched values');
}finally{
 rmSync(temp,{recursive:true,force:true});
}
console.log('PASS: explicit example paths, absent/empty library rejection and credential scan failures');
