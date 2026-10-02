import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
/** Bundle the actual Shell and project-owned browser extensions, without nested network frames. */
export async function appsAssets(appRoot:string,projectRoot:string,dataDir:string){
  mkdirSync(dataDir,{recursive:true});
  const entry=join(dataDir,'apps-entry.tsx'),project=join(projectRoot,'browser.ts');
  writeFileSync(entry,`import {mountApps} from ${JSON.stringify(join(appRoot,'src/host/apps-browser.tsx'))};\n${existsSync(project)?`import extensions from ${JSON.stringify(project)};\nmountApps(extensions);`:'mountApps();'}`);
  const result=await Bun.build({entrypoints:[entry],target:'browser',splitting:false,minify:true,outdir:join(dataDir,'apps'),plugins:[{name:'project-core',setup(build){
    build.onResolve({filter:/^@saturn\/core$/},()=>({path:join(appRoot,'src/core.ts')}));
    build.onResolve({filter:/^(react|react-dom)(\/.*)?$/},args=>({path:Bun.resolveSync(args.path,appRoot)}));
  }}]});
  if(!result.success)throw new Error(result.logs.map(log=>log.message).join('\n'));
  const css=(await Promise.all(result.outputs.filter(output=>output.path.endsWith('.css')).map(output=>output.text()))).join('\n');
  const js=(await Promise.all(result.outputs.filter(output=>output.path.endsWith('.js')).map(output=>output.text()))).join('\n');
  // HTML raw-text closing tags in authored assets must not escape script/style elements.
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saturn</title><style>${css.replace(/<\/style/gi,'<\\/style')}\n#apps-bar{height:36px;display:flex;gap:12px;align-items:center;padding:0 12px;background:var(--bg,#f5f6f8);font:12px system-ui}#root{height:calc(100dvh - 36px)}#root>.shell{height:100%}#apps-bar button{font:inherit}#apps-error{color:#b42318}</style></head><body><nav id="apps-bar"><strong>Saturn</strong><span id="apps-status">Connecting…</span><button id="apps-fullscreen" hidden>Full screen</button><button id="apps-open">Open in Saturn ↗</button><span id="apps-error" role="alert"></span></nav><div id="root"></div><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
  return {html,uri:`ui://saturn/app-${createHash('sha256').update(html).digest('hex').slice(0,16)}.html`};
}
