/** Qualification-only process identity observation. Never kills or adopts a process. */
import {execFile} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import {promisify} from 'node:util';
const run=promisify(execFile);
export type BrowserProcessIdentity={pid:number;ppid:number;born:string};
async function processes():Promise<BrowserProcessIdentity[]>{
  if(process.platform==='win32'){
    const script="Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='node.exe'\" | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;ppid=$_.ParentProcessId;born=$_.CreationDate.ToUniversalTime().ToString('o')} } | ConvertTo-Json -Compress";
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});
    const value=JSON.parse(stdout||'[]');return Array.isArray(value)?value:[value];
  }
  if(process.platform==='linux'){
    const entries=(await readdir('/proc')).filter(name=>/^\d+$/.test(name));
    if(entries.length>4096)throw new Error('Qualification process observation capacity exceeded.');
    const rows=await Promise.all(entries.map(async name=>{try{const text=await readFile('/proc/'+name+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).trim().split(/\s+/);
      return {pid:Number(name),ppid:Number(fields[1]),born:fields[19]};}catch{return null;}}));
    return rows.filter((row):row is BrowserProcessIdentity=>row!==null);
  }
  if(process.platform==='darwin'){
    const {stdout}=await run('ps',['-axo','pid=,ppid=,lstart='],{timeout:10000,maxBuffer:1024*1024});
    return stdout.trim().split('\n').map(line=>{const match=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);if(!match)throw new Error('Unverified process identity.');return {pid:Number(match[1]),ppid:Number(match[2]),born:match[3]};});
  }
  throw new Error('This runtime has no qualification process observer.');
}
export async function observeBrowserProcessTree(peerPid:number){
  const rows=await processes(),selected=new Set([peerPid]);
  for(let pass=0;pass<16;pass++){const prior=selected.size;for(const row of rows)if(selected.has(row.ppid))selected.add(row.pid);if(selected.size===prior)break;}
  const identities=rows.filter(row=>selected.has(row.pid));
  if(!identities.some(row=>row.pid===peerPid)||identities.length<2)throw new Error('Original browser process tree was not observed.');
  return identities;
}
export async function observedBrowserProcessesEnded(identities:BrowserProcessIdentity[]){
  const current=await processes();
  // PID reuse is a different process. Absence does not prove an action outcome.
  return identities.every(identity=>!current.some(row=>row.pid===identity.pid&&row.born===identity.born));
}
