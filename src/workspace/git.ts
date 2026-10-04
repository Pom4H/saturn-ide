import {summarizeSources} from './git-summary';
import type { GitReview } from '../core/git';
import type { GitState, GitCommit } from '../core/git';
import type { Workspace } from './files';
export async function execute(argv: string[], cwd: string, timeout = 15000): Promise<string> {
  const process = Bun.spawn(argv, { cwd, stdin:'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' } });
  let expired = false;
  const timer = setTimeout(() => { expired = true; process.kill(); }, timeout);
  try {
    const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (expired) throw new Error('Command timed out');
    if (code !== 0) throw new Error((err || out || `Command exited ${code}`).slice(0, 4000));
    return out.slice(0, 100_000);
  } finally { clearTimeout(timer); }
}
export class Git {
  constructor(readonly workspace: Workspace) {}
  private run(...args: string[]) { return execute(['git', ...args], this.workspace.root); }
  private fetchedAt:number|null=null;
  private async head(){return (await this.run('rev-parse','--verify','HEAD')).trim();}
  private validHash(hash:string){if(!/^[a-f0-9]{40,64}$/.test(hash))throw new Error('Expected a full commit hash');return hash;}
  async preview(hash:string){return this.run('diff','--no-ext-diff','--no-color','HEAD',this.validHash(hash),'--','.');}
  async review(commit?:string):Promise<GitReview> {
    const to=commit?this.validHash(commit):'working',head=await this.head().catch(()=>null);
    const from=commit?(await this.run('rev-list','--parents','-n','1',to)).trim().split(' ')[1]??null:head;
    const base=from??(await this.run('hash-object','-t','tree','--stdin')).trim();
    const args=commit?[base,to]:[base];
    let [tracked,untracked,diff]=await Promise.all([
      this.run('diff','--relative','--name-only','-z',...args,'--','.'),
      commit?Promise.resolve(''):this.run('ls-files','--others','--exclude-standard','-z','--','.'),
      this.run('diff','--no-ext-diff','--no-color','--relative',...args,'--','.'),
    ]);
    for(const path of untracked.split('\0').filter(Boolean)){if(diff.length>=100_000)break;try{const source=this.workspace.read(path).source,lines=source.split('\n');if(lines.at(-1)==='')lines.pop();diff+=`diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(line=>'+'+line).join('\n')+'\n';}catch{/* Binary and unsupported files stay in the file list. */}}
    diff=diff.slice(0,100_000);
    const files=[...new Set((tracked+untracked).split('\0').filter(Boolean))];
    const sources=[];let limited=diff.length>=100_000||files.length>60;
    for(const path of files.filter(p=>/\.tsx?$/.test(p)).slice(0,60)){
      const read=async(ref:string|null)=>ref?this.run('show',`${ref}:./${path}`).catch(()=>''):'';
      const before=await read(from),after=commit?await read(to):(()=>{try{return this.workspace.read(path).source;}catch{return '';}})();
      if(before.length>=100_000||after.length>=100_000){limited=true;continue;}
      sources.push({path,before,after});
    }
    return {from,to,diff,files,changes:summarizeSources(sources),limited};
  }
  async status():Promise<GitState> {
    const empty:GitState={available:false,branch:'',head:'',status:'',log:'',remotes:'',diff:'',commits:[],mainRef:null,ahead:0,behind:0,fetchedAt:this.fetchedAt};
    try{await this.run('rev-parse','--git-dir');}catch{return {...empty,installed:await this.run('--version').then(()=>true,()=>false)};}
    const [branch,status,remotes,head]=await Promise.all([this.run('branch','--show-current'),this.run('status','--porcelain=v1','--','.'),this.run('remote'),this.head().catch(()=>'')]);
    const remote=remotes.trim().split('\n').find(r=>r==='origin')??remotes.trim().split('\n')[0];
    const candidate=remote?`refs/remotes/${remote}/main`:'';
    const mainRef=candidate&&await this.run('rev-parse','--verify',candidate).then(()=>true,()=>false)?candidate:null;
    const [raw,diff,counts]=await Promise.all([
      head?this.run('log','--all','--topo-order','-60','--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e'):Promise.resolve(''),
      head?this.run('diff','HEAD','--','.'):this.run('diff','--cached','--','.'),
      head&&mainRef?this.run('rev-list','--left-right','--count',`HEAD...${mainRef}`):Promise.resolve('0 0'),
    ]);
    const commits:GitCommit[]=raw.split('\x1e').filter(s=>s.trim()).map(row=>{const [hash='',parents='',name='',email='',date='',subject='',refs='']=row.trim().split('\x1f');return {hash,parents:parents?parents.split(' '):[],name,email,date,subject,refs};});
    const [ahead=0,behind=0]=counts.trim().split(/\s+/).map(Number);
    return {...empty,available:true,installed:true,branch:branch.trim()||'detached',head,status,remotes:remotes.trim(),diff,commits,log:commits.slice(0,5).map(c=>`${c.hash.slice(0,7)} ${c.subject}`).join('\n'),mainRef,ahead,behind};
  }
  async action(action: string, message?: string, options:{expectedHead?:string;commit?:string}={}) {
    if(options.expectedHead!==undefined&&await this.head()!==options.expectedHead)throw new Error('HEAD changed; refresh before continuing');
    if (action === 'init') await this.run('init', '-b', 'main');
    else if (action === 'commit') {
      if (!message?.trim() || message.length > 500) throw new Error('A commit message is required');
      await this.run('add', '--', '.'); await this.run('commit', '--only', '-m', message, '--', '.');
    } else if(action==='fetch'){
      await this.run('fetch','--all','--prune');this.fetchedAt=Date.now();
    } else if (action === 'pull'||action==='pull-main') {
      if ((await this.run('status', '--porcelain')).trim()) throw new Error('Commit or stash changes before pulling');
      if(action==='pull')await this.run('pull','--ff-only');
      else{await this.run('fetch','--all','--prune');this.fetchedAt=Date.now();const state=await this.status();if(!state.mainRef)throw new Error('No remote main branch');await this.run('merge','--ff-only',state.mainRef);}
    } else if(action==='restore'){
      if(!options.expectedHead||!options.commit)throw new Error('Restore requires the reviewed HEAD and commit');
      const hash=this.validHash(options.commit);
      if((await this.run('status','--porcelain')).trim())throw new Error('Commit or stash all changes before restoring');
      await this.run('merge-base','--is-ancestor',hash,'HEAD');
      if(!(await this.preview(hash)).trim())throw new Error('Project already matches this commit');
      await this.run('restore',`--source=${hash}`,'--staged','--worktree','--','.');
      await this.run('commit','--only','-m',`Restore project to ${hash.slice(0,12)}`,'--','.');
    } else if (action === 'push') await this.run('push');
    else throw new Error('Unsupported Git action');
    return this.status();
  }
}
