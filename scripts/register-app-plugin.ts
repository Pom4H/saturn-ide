import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
/** Wire a real developer-mode connection ID into the portable package after registration. */
const id=process.argv[2];
if(!id||!/^plugin_asdk_app[A-Za-z0-9_-]+$/.test(id))throw new Error('Usage: bun scripts/register-app-plugin.ts plugin_asdk_app… (technical ID from the registered ChatGPT plugin URL)');
const root=resolve(import.meta.dir,'../.agents/plugins/saturn'),path=join(root,'plugin.json');
const manifest=JSON.parse(readFileSync(path,'utf8')) as {extensions:{'com.openai':Record<string,unknown>}};
writeFileSync(join(root,'.app.json'),JSON.stringify({apps:{saturn:{id,required:true}}},null,2)+'\n');
manifest.extensions['com.openai'].apps='./.app.json';writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
console.log('Registered Saturn app mapping saved:',join(root,'.app.json'));
