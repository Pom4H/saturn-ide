import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root=process.cwd(),out=resolve(root,'dist-pages'),assets=resolve(out,'assets');
rmSync(out,{recursive:true,force:true});mkdirSync(assets,{recursive:true});
const result=await Bun.build({entrypoints:[resolve(root,'site/main.tsx')],outdir:assets,naming:'site.[ext]',target:'browser',minify:true,sourcemap:'none'});
if(!result.success)throw new Error(result.logs.map(log=>log.message).join('\n'));
copyFileSync(resolve(root,'site/index.html'),resolve(out,'index.html'));
console.log(`GitHub Pages built: ${result.outputs.map(file=>file.path).join(', ')}`);
