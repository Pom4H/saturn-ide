export interface IDEAsset {platform:'darwin'|'linux'|'win32';arch:'arm64'|'x64';name:string;url:string;sha256:string;size:number}
export interface IDERelease {version:string;sourceRevision:string;publishedAt:string;notesUrl:string;assets:IDEAsset[]}
export interface IDEUpdate {current:string;platform:string;arch:string;checkedAt:number|null;status:'unchecked'|'current'|'available'|'unavailable';release:IDERelease|null;asset:IDEAsset|null;error?:string}
export function releaseManifest(value:unknown):IDERelease {
  if(!value||typeof value!=='object')throw new Error('Invalid release manifest');const r=value as IDERelease;
  const https=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
  if(!/^\d+\.\d+\.\d+$/.test(r.version)||!/^[a-f0-9]{40,64}$/.test(r.sourceRevision)||!Number.isFinite(Date.parse(r.publishedAt))||!https(r.notesUrl)||!Array.isArray(r.assets)||!r.assets.length||r.assets.length>10)throw new Error('Invalid release manifest');
  const keys=new Set<string>();for(const a of r.assets){const key=`${a.platform}-${a.arch}`;if(keys.has(key)||!['darwin','linux','win32'].includes(a.platform)||!['arm64','x64'].includes(a.arch)||!/^saturn-[a-z0-9-]+(\.exe)?$/.test(a.name)||!https(a.url)||!/^[a-f0-9]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.size)||a.size<=0)throw new Error('Invalid release asset');keys.add(key);}return r;
}
export function newerVersion(candidate:string,current:string){const a=candidate.split('.').map(Number),b=current.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!>b[i]!;}return false;}
