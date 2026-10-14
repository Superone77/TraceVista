import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const commands=[
 ['python3',['-m','unittest','discover','-s','skills/tracevista-skill/tests','-v']],
 [process.execPath,['viewer/scripts/test-state-trajectory.mjs']],
 [process.execPath,['viewer/scripts/test-semantic-trajectory.mjs']],
 [process.execPath,['viewer/scripts/test-story-disclosure.mjs']],
 [process.execPath,['viewer/scripts/test-story-records.mjs']],
 [process.execPath,['viewer/scripts/test-observations.mjs']],
 [process.execPath,['viewer/scripts/test-reading-layer.mjs']],
 [process.execPath,['viewer/scripts/test-ui-language.mjs']],
 [process.execPath,['viewer/scripts/test-i18n.mjs']],
 [process.execPath,['viewer/scripts/test-chat.mjs']],
 [process.execPath,['viewer/scripts/test-chat-images.mjs']],
 [process.execPath,['viewer/scripts/test-smart-context.mjs']],
 [process.execPath,['viewer/scripts/test-providers.mjs']],
 [process.execPath,['viewer/scripts/test-handoff.mjs']],
 [process.execPath,['scripts/test-datasets.mjs']],
 [process.execPath,['scripts/test-pi-example.mjs']],
 [process.execPath,['scripts/test-posttrainbench-example.mjs']],
 [process.execPath,['scripts/test-benchmark-examples.mjs']],
 ['python3',['scripts/check-example-secrets.py']],
];
for(const [command,args] of commands){
 const p=spawnSync(command,args,{cwd:root,stdio:'inherit'});
 if(p.error)throw p.error;
 if(p.status!==0)process.exit(p.status??1);
}
console.log('PASS: skill, viewer, bundled datasets, self-contained benchmark exports and example scan');
