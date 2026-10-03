/** Private-worker compatibility seam for the pinned Playwright launcher.
 * Capture its original child, never a caller-supplied PID. Windows tree shutdown
 * must not block this worker's event loop while browser exit/pipe events arrive.
 */
import childProcess,{type ChildProcess} from 'node:child_process';
import {isAbsolute,join,resolve} from 'node:path';

export function ownWindowsBrowserProcess(executable:string){
  if(process.platform!=='win32')return undefined;
  const systemRoot=process.env.SystemRoot;
  if(!systemRoot||!isAbsolute(systemRoot))throw new Error('COMPUTER_BROWSER_PROCESS_OWNER_UNAVAILABLE');
  const spawn=childProcess.spawn,expected=resolve(executable).toLowerCase();
  let browser:ChildProcess|undefined,closed:Promise<void>|undefined,forcing:Promise<void>|undefined,requested=false,forced=false;
  const force=()=>{
    requested=true;
    if(forced||!browser?.pid||browser.exitCode!==null||browser.signalCode!==null)return;
    forced=true;
    // Same original process tree as the pinned runtime, but no shell or
    // spawnSync. A command return is never treated as termination evidence.
    const command=spawn(join(systemRoot,'System32','taskkill.exe'),['/pid',String(browser.pid),'/T','/F'],
      {windowsHide:true,stdio:'ignore'});
    forcing=new Promise<void>(done=>command.once('close',()=>done()));
    command.on('error',()=>undefined); // Missing proof still times out at the original owner.
  };
  childProcess.spawn=((command:string,args:readonly string[],options:childProcess.SpawnOptions)=>{
    const owned=resolve(String(command)).toLowerCase()===expected&&Array.isArray(args)&&args.includes('--remote-debugging-pipe');
    if(owned&&browser)throw new Error('COMPUTER_BROWSER_PROCESS_ALREADY_OWNED');
    const child=spawn(command,args,options);
    if(owned){
      browser=child;closed=new Promise<void>(done=>child.once('close',()=>done()));
      if(requested)force();
    }
    return child;
  }) as typeof childProcess.spawn;
  // Do not leave a still-running tree-termination command behind an acknowledged
  // Stop, even if the original browser happened to finish graceful close first.
  return {force,closed:async()=>{await closed;await forcing;}};
}
