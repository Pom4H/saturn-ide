import { releaseManifest, newerVersion, type IDEUpdate } from '../core/distribution';
export class IDEUpdates {
  private pending:Promise<IDEUpdate>|undefined;
  state:IDEUpdate;
  constructor(current:string,readonly url=process.env.SATURN_IDE_MANIFEST_URL??'https://saturn-ide.vercel.app/api/downloads'){
    this.state={current,platform:process.platform,arch:process.arch,checkedAt:null,status:'unchecked',release:null,asset:null};
  }
  check(){return this.pending??=this.read().finally(()=>{this.pending=undefined;});}
  private async read(){
    try{const response=await fetch(this.url,{signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});if(!response.ok)throw new Error(`Release service: HTTP ${response.status}`);const raw=await response.text();if(raw.length>100000)throw new Error('Release manifest exceeds limit');const release=releaseManifest(JSON.parse(raw));const asset=release.assets.find(a=>a.platform===this.state.platform&&a.arch===this.state.arch)??null;
      this.state={...this.state,checkedAt:Date.now(),release,asset,status:newerVersion(release.version,this.state.current)?'available':'current',error:undefined};
    }catch(error){this.state={...this.state,checkedAt:Date.now(),status:'unavailable',error:error instanceof Error?error.message:String(error)};}
    return this.state;
  }
}
