import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Bundle trusted local project browser.ts separately from the headless runtime artifact. */
export async function browserAssets(appRoot: string, projectRoot: string, dataDir: string) {
  const projectEntry = join(projectRoot, 'browser.ts');
  const entry = join(dataDir, 'browser-entry.tsx');
  writeFileSync(entry, `import { mount } from ${JSON.stringify(join(appRoot, 'src/host/browser.tsx'))};\n${existsSync(projectEntry) ? `import displays from ${JSON.stringify(projectEntry)};\nmount(displays);` : 'mount();'}`);
  const result = await Bun.build({ entrypoints: [entry], target: 'browser', minify: false, splitting: true, outdir: join(dataDir, 'browser'), naming: {entry:'app.[ext]',chunk:'[name]-[hash].[ext]',asset:'[name]-[hash].[ext]'}, plugins:[{name:'project-core',setup(build){
    build.onResolve({filter:/^@saturn\/core$/},()=>({path:join(appRoot,'src/core.ts')}));
    build.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:Bun.resolveSync(args.path,appRoot)}));
  }}] });
  if (!result.success) throw new Error(result.logs.map(log=>log.message).join('\n'));
  const assets = new Map(result.outputs.map(output=>['/assets/'+output.path.split('/').at(-1), output]));
  const css = result.outputs.filter(output=>output.path.endsWith('.css')).map(output=>`<link rel="stylesheet" href="/assets/${output.path.split('/').at(-1)}">`).join('');
  const html = readFileSync(join(appRoot,'src/shell/index.html'),'utf8').replace('<link rel="stylesheet" href="./styles.css">',css).replace('../host/browser.tsx','/assets/app.js');
  return { html, assets };
}
