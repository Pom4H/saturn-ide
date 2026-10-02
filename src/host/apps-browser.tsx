import {App} from '@modelcontextprotocol/ext-apps';
import {mount,type BrowserProject} from './browser';
import {configureBrowserClient} from '../shell/api';
import {AppsClient} from '../shell/apps-client';
import {configureEmbeddedView,restoreEmbeddedView,viewLocation} from '../shell/view-location';
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
export async function mountApps(project:BrowserProject={}){
  const app=new App({name:'Saturn',version:'0.2.0'},{},{autoResize:false});
  const client=new AppsClient(app),error=document.getElementById('apps-error')!,status=document.getElementById('apps-status')!;
  const fail=(reason:unknown)=>{error.textContent=reason instanceof Error?reason.message:String(reason);};
  let unmount:(()=>void)|undefined,cleanup:(()=>void)|undefined;
  let mounted=false,search='?page=diagram&dimension=2d';
  app.ontoolresult=result=>{
    const saturn=record(record(result._meta).saturn),view=record(saturn.view);
    if(typeof saturn.workspaceUrl==='string')client.workspaceUrl=saturn.workspaceUrl;
    if(typeof view.search==='string'&&view.search.startsWith('?')){search=view.search;if(mounted)restoreEmbeddedView(search);}
  };
  app.onhostcontextchanged=context=>{if(context.theme)document.documentElement.dataset.theme=context.theme;};
  app.onteardown=async()=>{status.textContent='Closed';cleanup?.();unmount?.();mounted=false;return {};};
  try{
    await app.connect();
    const context=app.getHostContext();if(context?.locale){document.documentElement.lang=context.locale;if(!localStorage.getItem('saturn.language'))localStorage.setItem('saturn.language',context.locale.startsWith('ru')?'ru':'en');}
    if(context?.theme){document.documentElement.dataset.theme=context.theme;if(!localStorage.getItem('saturn.theme'))localStorage.setItem('saturn.theme',context.theme);}
    if(!localStorage.getItem('saturn.preset'))localStorage.setItem('saturn.preset','business');
    const full=document.getElementById('apps-fullscreen') as HTMLButtonElement;
    full.hidden=!context?.availableDisplayModes?.includes('fullscreen');full.onclick=()=>{void app.requestDisplayMode({mode:'fullscreen'}).catch(fail);};
    document.getElementById('apps-open')!.onclick=()=>{if(client.workspaceUrl)void app.openLink({url:client.workspaceUrl+'/'+viewLocation.search}).catch(fail);};
    configureEmbeddedView(search);configureBrowserClient(client);unmount=mount(project,true);mounted=true;status.textContent='Connected via MCP';
    let last='',timer:ReturnType<typeof setTimeout>|undefined;
    const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      const url=client.workspaceUrl+'/'+viewLocation.search;if(url===last||!client.workspaceUrl)return;last=url;
      void app.updateModelContext({content:[{type:'text',text:'Current Saturn view: '+url}],structuredContent:{url,view:Object.fromEntries(new URLSearchParams(viewLocation.search))}}).catch(fail);
    },200);};
    addEventListener('saturn-view-change',update);addEventListener('popstate',update);cleanup=()=>{clearTimeout(timer);removeEventListener('saturn-view-change',update);removeEventListener('popstate',update);};update();
  }catch(reason){status.textContent='Connection failed';fail(reason);}
}
