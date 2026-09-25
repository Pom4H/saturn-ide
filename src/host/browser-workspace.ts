import type { AuthoredFile, AuthoringFrame, AuthoredChange } from '../core/authoring';
import { validateProject, type Problem } from '../core';
import { digest } from '../core/artifact';
import { ShellSession } from '../shell/model/session';
import { LayoutEditing } from '../shell/model/layout-editing';
import { SourceEditing } from '../shell/model/source-editing';
import type { LanguageRequest } from '../shell/editor';
import type { SourceLibrary } from '../workspace/memory-language';

interface Check { frame?: AuthoringFrame; problems: Problem[] }
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
/** A browser host adapter for the real Shell/session and compiler. Runtime remains an explicit separate consumer. */
export class BrowserWorkspace {
  readonly session: ShellSession;
  readonly layout: LayoutEditing;
  readonly editing: SourceEditing;
  private files = new Map<string, AuthoredFile>();
  private iframe: HTMLIFrameElement;
  private pending = new Map<string, Pending>();
  private channel = crypto.randomUUID();
  private ready: Promise<void>;
  private onMessage: (event: MessageEvent) => void;
  private revision = 0;
  private closed=false;
  private readyTimer:ReturnType<typeof setTimeout>;
  private rejectReady:(reason:Error)=>void=()=>{};
  constructor(initial: readonly AuthoredFile[], workerSource: string, private readonly library: SourceLibrary) {
    for (const file of initial) this.files.set(file.path, file);
    this.session = new ShellSession('browser', {
      read: async path => { const file = this.files.get(path); if (!file) throw new Error('Document missing'); return file; },
      saveMany:async files=>{
        if(files.some(file=>this.files.get(file.path)?.version!==file.version))throw new Error('Source changed before save');
        const saved=await Promise.all(files.map(async file=>({...file,version:await digest(file.source)})));
        if(files.some(file=>this.files.get(file.path)?.version!==file.version))throw new Error('Concurrent save');
        for(const file of saved)this.files.set(file.path,file);return saved;
      },
      save: async file => {
        if (this.files.get(file.path)?.version !== file.version) throw new Error('Document changed before save');
        const saved = { ...file, version: await digest(file.source) };
        if (this.files.get(file.path)?.version !== file.version) throw new Error('Concurrent save');
        this.files.set(file.path, saved); return saved;
      },
    });
    this.layout = new LayoutEditing(this.session.documents);
    this.editing = new SourceEditing(this.session.documents, async (files, _frame, edit) => await this.request<AuthoredChange[]>({ operation: 'plan', files, edit }));
    this.iframe = document.createElement('iframe'); this.iframe.hidden = true; this.iframe.setAttribute('sandbox', 'allow-scripts'); this.iframe.title = 'Isolated TypeScript compiler';
    const channel = JSON.stringify(this.channel), code = JSON.stringify(workerSource).replaceAll('<', '\\u003c'), nonce = crypto.randomUUID();
    // Worker inherits this CSP through its blob URL; the iframe intentionally has no allow-same-origin.
    this.iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">
      const workers=new Map();
      addEventListener('message',event=>{if(event.source!==parent||event.data.channel!==${channel})return;const {id,payload,cancel}=event.data;if(cancel){workers.get(id)?.terminate();workers.delete(id);return;}
        const url=URL.createObjectURL(new Blob([${code}],{type:'text/javascript'}));
        let worker;try{worker=new Worker(url);workers.set(id,worker);}catch(error){parent.postMessage({channel:${channel},id,error:String(error)},'*');URL.revokeObjectURL(url);return;}
        const finish=data=>{if(!workers.has(id))return;workers.delete(id);worker.terminate();URL.revokeObjectURL(url);parent.postMessage({channel:${channel},id,...data},'*');};
        worker.onmessage=event=>finish(event.data);worker.onerror=event=>finish({error:event.message});worker.postMessage(payload);
      });parent.postMessage({channel:${channel},ready:true},'*');
    <\/script>`;
    let prepared: () => void;
    this.ready = new Promise((resolve,reject) => { prepared = resolve;this.rejectReady=reject; });
    this.readyTimer=setTimeout(()=>this.rejectReady(new Error('The browser blocked the isolated compiler')),12000);
    void this.ready.catch(()=>{});
    this.onMessage = event => {
      if (event.source !== this.iframe.contentWindow || event.data?.channel !== this.channel) return;
      if (event.data.ready) { clearTimeout(this.readyTimer);prepared(); return; }
      const pending = this.pending.get(event.data.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(String(event.data.error))); else pending.resolve(event.data.value);
    };
    window.addEventListener('message', this.onMessage); document.body.append(this.iframe);
  }
  private async request<T>(payload: object): Promise<T> {
    if(this.closed)throw new Error('Workspace closed');
    await this.ready;
    if(this.closed)throw new Error('Workspace closed');
    const id = String(++this.revision);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); this.iframe.contentWindow?.postMessage({ channel: this.channel, id, cancel: true }, '*'); reject(new Error('TypeScript worker exceeded its time budget'));
      }, 12000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.iframe.contentWindow!.postMessage({ channel: this.channel, id, payload: { ...payload, library: this.library } }, '*');
    });
  }
  async open() { for (const path of this.files.keys()) await this.session.documents.open(path); }
  private authored(): AuthoredFile[] {
    return [...this.files.values()].map(file => ({ ...file, source: this.session.documents.getSnapshot().get(file.path)?.draft ?? file.source }));
  }
  async check(): Promise<Check> {
    const files = this.authored(), result = await this.request<Check>({ operation: 'check', files });
    if (files.some(file => this.session.documents.getSnapshot().get(file.path)?.draft !== file.source)) throw new Error('Stale source check');
    if (result.frame) {
      await this.session.documents.saveMany(files.map(file=>file.path));
      if(files.some(file=>this.session.documents.getSnapshot().get(file.path)?.draft!==file.source))throw new Error('Stale source check');
      validateProject(result.frame.project);
      this.checkMarkup(result.frame);
      const saved = this.authored(); result.frame.files = saved;
      for (const position of Object.values(result.frame.positions)) position.version = saved.find(file => file.path === position.path)!.version;
      this.editing.reconcile(result.frame); this.layout.reconcile(result.frame.scene.equipment);
    }
    return result;
  }
  language: LanguageRequest = async <T>(operation: string, path: string, source: string, position: number, locale: 'ru' | 'en') => {
    const files = this.authored().map(file => file.path === path ? { ...file, source } : file);
    return await this.request<T>({ operation: 'language', files, query: { operation, path, position, locale } });
  };
  private checkMarkup(frame:AuthoringFrame){
    // Guest code cannot turn a returned SVG into same-origin executable DOM.
    const elements=new Set(['svg','g','defs','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','title','desc','clippath','mask','lineargradient','radialgradient','stop','use']);
    for(const equipment of frame.scene.equipment){
      const svg=equipment.capabilities.diagram?.svg;if(!svg)continue;
      if(svg.length>256000)throw new Error('SVG exceeds preview limit');
      const tree=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+svg+'</svg>','image/svg+xml');
      if(tree.querySelector('parsererror'))throw new Error('Invalid SVG preview');
      for(const element of tree.querySelectorAll('*')){
        if(element.namespaceURI!=='http://www.w3.org/2000/svg'||!elements.has(element.localName.toLowerCase()))throw new Error('Unsupported active SVG content in preview');
        for(const attribute of element.attributes){
          const name=attribute.name.toLowerCase(),value=attribute.value;
          if(name.startsWith('on')||name==='style'||/javascript:|data:text|https?:|\/\//i.test(value)&&name!=='xmlns'||(/href$/.test(name)&&!/^#[\w.-]+$/.test(value))||/url\(/i.test(value)&&!/^url\(#[\w.-]+\)$/.test(value))throw new Error('External or executable SVG is not allowed in browser preview');
        }
      }
    }
  }
  close() {
    this.closed=true;clearTimeout(this.readyTimer);this.rejectReady(new Error('Workspace closed'));
    window.removeEventListener('message', this.onMessage); this.iframe.remove();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Workspace closed')); } this.pending.clear();
  }
}
