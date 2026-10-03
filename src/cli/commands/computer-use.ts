/** Explicit local runtime qualification; it cannot enable a daemon or issue a grant. */
import {open,realpath} from "node:fs/promises";
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from "node:path";
import type {ParsedArgs} from "../dg.js";
import {qualifyBrowserRuntime,browserQualificationFailureDetails} from "../../computer/qualify-browser.js";
import {resolveMasterDir} from "../../instance/registry.js";
const help=`
dg computer-use — Qualify the installed isolated browser runtime (no model calls)

Usage:
  dg computer-use qualify --browser-executable <absolute-path> --browser-version <exact-version> --worker-id <id> --out <new-file>

Runs a disposable local browser fixture and core receipt/unknown-effect checks.
The output pins this installed DreamGraph worker, Node, OS, architecture and
browser version. It reports measured subchecks, not full Ashoka CU acceptance.
It creates a new qualification file; existing files are refused. No daemon,
engine.env, project graph, personal browser, model allocation or grant changes.
An upgrade or changed browser/Node version requires fresh qualification.
Ctrl+C cancels the fixture and independently stops its isolated browsers.
`;
const required=(flags:ParsedArgs["flags"],name:string)=>{const value=flags[name];if(typeof value!=="string"||!value.trim())throw new Error(`--${name} is required`);return value;};
export async function cmdComputerUse(positional:string[],flags:ParsedArgs["flags"]){
  if(flags.help||flags.h){console.log(help);return;}
  if(positional.length!==1||positional[0]!=="qualify")throw new Error("Run dg computer-use --help for the qualification command.");
  const input={browser_executable:required(flags,"browser-executable"),browser_version:required(flags,"browser-version"),worker_id:required(flags,"worker-id")};
  const output=resolve(required(flags,"out")),physical=join(await realpath(dirname(output)),basename(output));
  const master=await realpath(resolveMasterDir()).catch(error=>{if(error.code==="ENOENT")return resolveMasterDir();throw error;});
  const fold=(value:string)=>process.platform==="win32"?value.toLowerCase():value,rel=relative(fold(master),fold(physical));
  if(!rel||rel!==".."&&!rel.startsWith(".."+sep)&&!isAbsolute(rel))throw new Error("Qualification output must be outside the DreamGraph master/instance directory.");
  const file=await open(physical,"wx");
  const controller=new AbortController(),cancel=()=>controller.abort(new Error("COMPUTER_QUALIFICATION_CANCELLED"));
  process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
  try{
    const result=await qualifyBrowserRuntime(input,controller.signal);
    controller.signal.throwIfAborted();await file.writeFile(JSON.stringify(result,null,2)+"\n");await file.datasync();
    console.log(JSON.stringify({qualification_path:physical,worker_id:result.worker.id,platform:result.evidence.platform,architecture:result.evidence.architecture,
      browser_version:result.worker.browser_version,node:result.evidence.node,model_requests:0,measured_checks:result.evidence.traces.length,
      evidence_hash:result.worker.qualification.artifact_hash,stop_release_ms:result.worker.qualification.stop_release_ms,control_loss_stop_ms:result.worker.qualification.control_loss_stop_ms,
      note:"Qualification only. Instance setup, target review and explicit scoped permission are separate."},null,2));
  }catch(error){
    const reason=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:"COMPUTER_QUALIFICATION_FAILED";
    const details=browserQualificationFailureDetails(error);
    await file.writeFile(JSON.stringify({schema:"dreamgraph.browser_runtime_qualification_failure.v1",qualified:false,reason,model_requests:0,
      ...(details?{details}:{})})+"\n").catch(()=>undefined);throw error;
  }finally{process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);await file.close();}
}
