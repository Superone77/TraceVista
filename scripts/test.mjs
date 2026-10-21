import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const commands=[
 [process.execPath,['scripts/test-agent-plugins.mjs']],
 ['python3',['scripts/test-example-secrets.py']],
 ['python3',['-m','unittest','discover','-s','skills/tracevista-skill/tests','-v']],
 [process.execPath,['viewer/scripts/test-state-trajectory.mjs']],
 [process.execPath,['viewer/scripts/test-semantic-trajectory.mjs']],
 [process.execPath,['viewer/scripts/test-story-disclosure.mjs']],
 [process.execPath,['viewer/scripts/test-playback.mjs']],
 [process.execPath,['viewer/scripts/test-panel-sizing.mjs']],
 [process.execPath,['viewer/scripts/test-story-records.mjs']],
 [process.execPath,['viewer/scripts/test-observations.mjs']],
 [process.execPath,['viewer/scripts/test-reading-layer.mjs']],
 [process.execPath,['viewer/scripts/test-ui-language.mjs']],
 [process.execPath,['viewer/scripts/test-i18n.mjs']],
 [process.execPath,['viewer/scripts/test-chat.mjs']],
 [process.execPath,['viewer/scripts/test-explanations.mjs']],
 [process.execPath,['viewer/scripts/test-chat-images.mjs']],
 [process.execPath,['viewer/scripts/test-smart-context.mjs']],
 [process.execPath,['viewer/scripts/test-chat-connection.mjs']],
 [process.execPath,['viewer/scripts/test-hosted-chat.mjs']],
 [process.execPath,['viewer/scripts/test-providers.mjs']],
 [process.execPath,['viewer/scripts/test-handoff.mjs']],
 [process.execPath,['scripts/test-datasets.mjs']],
 [process.execPath,['scripts/test-example-paths.mjs']],
 [process.execPath,['scripts/test-example-build.mjs']],
 [process.execPath,['scripts/test-example-lock.mjs']],
];
for(const [command,args] of commands){
 const p=spawnSync(command,args,{cwd:root,stdio:'inherit'});
 if(p.error)throw p.error;
 if(p.status!==0)process.exit(p.status??1);
}
console.log('PASS: core skill, viewer, dataset routing and example-library path checks');
