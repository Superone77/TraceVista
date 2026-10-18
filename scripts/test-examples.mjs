import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exampleLibraryRoot} from './example-library.mjs';
import {loadExampleLibrary} from '../viewer/example-library.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const library=exampleLibraryRoot(); // Fail before running checks if the library is absent.
loadExampleLibrary(root, library); // Check the exact assets that the website will publish.
const commands=[
 [process.execPath,['scripts/test-example-catalog.mjs']],
 [process.execPath,['scripts/test-pi-example.mjs']],
 [process.execPath,['scripts/test-posttrainbench-example.mjs']],
 [process.execPath,['scripts/test-benchmark-examples.mjs']],
 ['python3',['scripts/check-example-secrets.py','--examples-dir',library]],
];
for(const [command,args]of commands){
 const p=spawnSync(command,args,{cwd:root,stdio:'inherit',env:{...process.env,TRACEVISTA_EXAMPLES_DIR:library}});
 if(p.error)throw p.error;
 if(p.status!==0)process.exit(p.status??1);
}
console.log('PASS: external example catalog, complete exports, evidence checks and credential/local-path scan');
