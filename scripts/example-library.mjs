import {existsSync, readFileSync, statSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../../TraceVista-examples/',import.meta.url));

// The directory is the example repository root, containing examples/index.json.
// An explicitly configured path must never fall back to a different library.
export function exampleLibraryRoot(configured=process.env.TRACEVISTA_EXAMPLES_DIR){
 const root=configured===undefined?defaultRoot:resolve(configured);
 if(configured!==undefined&&!configured.trim())throw new Error('TRACEVISTA_EXAMPLES_DIR must name an example library directory.');
 const catalog=join(root,'examples','index.json');
 if(!existsSync(catalog)||!statSync(catalog).isFile())throw new Error(`Example library not found at ${root}. Set TRACEVISTA_EXAMPLES_DIR to the TraceVista-examples repository root (containing examples/index.json).`);
 return root;
}

export function exampleFile(file,root=exampleLibraryRoot()){
 if(!/^[a-zA-Z0-9_-]+\.agent-state\.json$/.test(file))throw new Error(`Invalid example filename: ${file}`);
 return join(root,'examples',file);
}

export function exampleCatalog(root=exampleLibraryRoot()){
 const catalog=JSON.parse(readFileSync(join(root,'examples','index.json'),'utf8'));
 if(!Array.isArray(catalog)||!catalog.length)throw new Error('The example catalog must contain at least one example.');
 return catalog;
}
