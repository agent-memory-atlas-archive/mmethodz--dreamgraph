/** Private test-worker preload: drop only Chromium's graceful CDP close frame.
 * The actual browser stays alive until the original Playwright process owner
 * terminates it. No product action, reply, clock or termination proof is faked.
 */
import childProcess from 'node:child_process';
import {fileURLToPath} from 'node:url';
const spawn=childProcess.spawn;
childProcess.spawn=function(command,args,...options){
 if(process.env.DREAMGRAPH_TEST_DELAY_TREE_STOP==='1500'&&/taskkill\.exe$/i.test(command)){
  // Real owned helper remains alive after OS termination. No exit/receipt is faked.
  return spawn.call(this,process.execPath,[fileURLToPath(new URL('./computer-delayed-tree-stop.mjs',import.meta.url)),command,...args],...options);
 }
 const child=spawn.call(this,command,args,...options);
 if(Array.isArray(args)&&args.includes('--remote-debugging-pipe')){
  const pipe=child.stdio[3],write=pipe.write.bind(pipe);let terminator=false;
  pipe.write=function(chunk,...rest){
   const text=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk);
   if(/"method"\s*:\s*"Browser\.close"/.test(text)){
    terminator=!text.endsWith('\0');process.send?.({test_fault:'graceful_close_dropped'});
   }else if(terminator&&text==='\0'){terminator=false;}
   else return write(chunk,...rest);
   const callback=rest.find(value=>typeof value==='function');callback?.();return true;
  };
 }
 return child;
};
