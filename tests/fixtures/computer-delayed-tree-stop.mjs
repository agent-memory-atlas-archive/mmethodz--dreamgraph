/** Test-only real termination helper; deliberately retain its process for 1.5 s. */
import {spawn} from 'node:child_process';
import {join} from 'node:path';
const [command,...args]=process.argv.slice(2);
if(command!==join(process.env.SystemRoot,'System32','taskkill.exe')||args.length!==4||args[0]!=='/pid'||!/^\d+$/.test(args[1])||args[2]!=='/T'||args[3]!=='/F')throw new Error('INVALID_TEST_TERMINATION_TARGET');
const child=spawn(command,args,{windowsHide:true,stdio:'ignore'});
child.once('error',()=>process.exit(1));
child.once('close',code=>setTimeout(()=>process.exit(code??1),1500));
