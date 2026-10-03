/** Explicit daemon API pass. It never borrows the editor's local CLI/model or repeats input after a lost reply. */
import type {DaemonClient} from './daemon-client.js';
import {NativeComputerPassRequestSchema,type NativeComputerSetup,type NativeComputerPreparation,type NativeComputerConfirmation,type NativeComputerPassRequest,type NativeComputerPassReply} from './generated/computer-pass.js';
import type {ManagedExecutionSnapshot} from './generated/graph-contracts.js';
import type {ComputerOperatorSnapshot} from '@dreamgraph/sdk/seams/computer-control' with {"resolution-mode":"import"};
export type ComputerPassPort=Pick<DaemonClient,'baseUrl'|'readComputerPassSetup'|'prepareComputerPass'|'confirmComputerPass'|'cancelComputerPass'|'runComputerPass'|'readExecution'|'readComputerStatus'|'controlComputer'>;
export interface ComputerPassView {status:'idle'|'loading'|'ready'|'prepared'|'confirming'|'confirmed'|'running'|'recovering'|'settled'|'unconfirmed'|'error';
 endpoint?:string;instanceId?:string;setup?:NativeComputerSetup;preparation?:NativeComputerPreparation;confirmation?:NativeComputerConfirmation;
 execution?:ManagedExecutionSnapshot;dispatched:boolean;busy:boolean;cancellationRequested?:boolean;message?:string;}
type Context={port:ComputerPassPort;endpoint:string;instanceId:string};
const closed=(value:ManagedExecutionSnapshot)=>!value.authority_active&&['no_change','state_committed','graph_committed'].includes(value.status);
const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 signal.throwIfAborted();const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
 const abort=()=>{cleanup();reject(signal.reason??new Error('COMPUTER_PASS_WAIT_STOPPED'));};const timer=setTimeout(()=>{cleanup();resolve();},ms);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});
export class ComputerPassController {
 private context?:Context;private state:ComputerPassView={status:'idle',dispatched:false,busy:false};
 private pending?:AbortController;private run?:AbortController;private monitor?:AbortController;private generation=0;private disposed=false;
 constructor(private emit:(view:ComputerPassView)=>void,private hooks:{authority?:(execution:ManagedExecutionSnapshot,signal:AbortSignal)=>Promise<void>;
  session?:(port:ComputerPassPort,instanceId:string,executionId:string,id:string,value:ComputerOperatorSnapshot)=>void;
  closure?:(execution:ManagedExecutionSnapshot)=>void}={},private intervalMs=250){}
 get view(){return structuredClone(this.state);}
 get blocksContinuation(){return this.state.busy||!!this.state.preparation&&this.state.status!=='settled';}
 private publish(value:Partial<ComputerPassView>){this.state={...this.state,...value};this.emit(this.view);}
 private owner(port:ComputerPassPort|undefined,instanceId:string){const context=this.context;
  if(this.disposed||!context||!port||context.port!==port||port.baseUrl!==context.endpoint||instanceId!==context.instanceId)throw new Error('COMPUTER_PASS_OWNER_CHANGED');return context;}
 private original(){const context=this.context;if(!context)throw new Error('COMPUTER_PASS_ORIGINAL_REQUIRED');return this.owner(context.port,context.instanceId);}
 private identity(value:ManagedExecutionSnapshot){if(value.instance_id!==this.context?.instanceId||value.execution_id!==this.state.preparation?.execution_id)throw new Error('COMPUTER_PASS_EXECUTION_OWNER_MISMATCH');return value;}
 private originalSession(value:ComputerOperatorSnapshot){if(value.session.instance_id!==this.context?.instanceId||value.session.execution_id!==this.state.preparation?.execution_id
  ||value.session.id!==this.state.preparation?.id)throw new Error('COMPUTER_PASS_SESSION_OWNER_MISMATCH');return value;}
 private idle(){if(this.disposed||this.pending||this.run)throw new Error('COMPUTER_PASS_BUSY');}
 async setup(port:ComputerPassPort|undefined,instanceId:string){this.idle();if(this.blocksContinuation)throw new Error('COMPUTER_PASS_ORIGINAL_RECOVERY_REQUIRED');
  if(!port||!instanceId||instanceId==='default')throw new Error('COMPUTER_PASS_INSTANCE_REQUIRED');const context={port,endpoint:port.baseUrl,instanceId};
  this.context=context;const controller=new AbortController(),generation=++this.generation;this.pending=controller;
  this.state={status:'loading',endpoint:context.endpoint,instanceId,dispatched:false,busy:true};this.publish({message:'Reading the configured daemon computer_use API role and target…'});
  try{const setup=await port.readComputerPassSetup(controller.signal);this.owner(port,instanceId);controller.signal.throwIfAborted();
   if(generation!==this.generation)return;if('instance_id' in setup&&setup.instance_id!==instanceId)throw new Error('COMPUTER_PASS_SETUP_INSTANCE_MISMATCH');
   this.publish({status:'ready',setup,busy:false,message:setup.available?'Review this scope; preparing it launches no browser and makes no model call.':'Computer Use unavailable for this daemon configuration.'});
  }catch(error){if(generation===this.generation)this.publish({status:'error',busy:false,message:String(error)});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 async prepare(port:ComputerPassPort|undefined,instanceId:string,input:{interact:boolean;duration_ms:number}){this.idle();const context=this.owner(port,instanceId);
  if(this.state.preparation&&this.state.status!=='settled'||!this.state.setup?.available)throw new Error('COMPUTER_PASS_SCOPE_REVIEW_REQUIRED');
  const controller=new AbortController(),generation=this.generation;this.pending=controller;this.publish({status:'loading',busy:true,message:'Preparing the captured scope; no permission or browser is issued yet…'});
  try{const preparation=await context.port.prepareComputerPass(input,controller.signal);this.owner(port,instanceId);controller.signal.throwIfAborted();
   if(generation!==this.generation)return;if(preparation.instance_id!==instanceId)throw new Error('COMPUTER_PASS_SETUP_INSTANCE_MISMATCH');
   // The freshly sealed scope is shown again before confirmation, including any configuration change.
   this.publish({status:'prepared',preparation,confirmation:undefined,execution:undefined,dispatched:false,cancellationRequested:false,busy:false,message:'Confirm this exact prepared scope to grant permission, then start once.'});
  }catch(error){if(generation===this.generation)this.publish({status:'error',busy:false,message:String(error)});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 async confirm(port:ComputerPassPort|undefined,instanceId:string,id:string){this.idle();const context=this.owner(port,instanceId),preparation=this.state.preparation;
  if(!preparation||preparation.id!==id||this.state.dispatched||this.state.cancellationRequested||!['prepared','unconfirmed'].includes(this.state.status))throw new Error('COMPUTER_PASS_EXACT_CONFIRMATION_REQUIRED');
  const controller=new AbortController(),generation=this.generation;this.pending=controller;this.publish({status:'confirming',busy:true,message:'Confirming the original scope; an uncertain reply permits only this exact confirmation retry or cancellation…'});
  try{const confirmation=await context.port.confirmComputerPass(id,controller.signal);this.owner(port,instanceId);controller.signal.throwIfAborted();
   if(generation!==this.generation)return;if(confirmation.id!==id||confirmation.execution_id!==preparation.execution_id)throw new Error('COMPUTER_PASS_CONFIRMATION_OWNER_MISMATCH');
   this.publish({status:'confirmed',confirmation,busy:false,message:'Original scope confirmed. Start uses the displayed daemon role; the local Architect model is unchanged.'});
  }catch(error){if(generation===this.generation)this.publish({status:'unconfirmed',busy:false,message:`Confirmation reply unconfirmed. Retain preparation ${id}; retry the same confirmation or cancel. ${String(error)}`});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 async cancel(port:ComputerPassPort|undefined,instanceId:string,id:string){const context=this.owner(port,instanceId),preparation=this.state.preparation;
  if(!preparation||preparation.id!==id||this.run||this.state.dispatched&&this.state.status!=='unconfirmed')throw new Error('COMPUTER_PASS_UNUSED_PREPARATION_REQUIRED');
  // Cancellation bypasses an outstanding confirmation. The authority serializes them on this original preparation.
  this.pending?.abort();this.pending=undefined;const controller=new AbortController();this.pending=controller;this.generation++;
  this.publish({status:'recovering',busy:true,cancellationRequested:true,message:'Requesting cancellation only if the original preparation was never claimed. A started execution still requires Stop and closure inspection…'});
  try{const result=await context.port.cancelComputerPass(id,controller.signal);this.owner(port,instanceId);controller.signal.throwIfAborted();
   if(result.id!==id||result.execution_id!==preparation.execution_id||result.status!=='cancelled')throw new Error('COMPUTER_PASS_CANCELLATION_OWNER_MISMATCH');
   this.publish({status:'settled',busy:false,message:result.grant_revoked?'Original unused preparation cancelled and grant revoked. No browser or model work was started.':'Original unused preparation cancelled; no grant was issued.'});
  }catch(error){this.publish({status:'unconfirmed',busy:false,message:`Cancellation unconfirmed for ${id}; retry cancellation of the same preparation. ${String(error)}`});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 private async watch(context:Context,preparation:NativeComputerPreparation,controller:AbortController){let reviewOpened=false,sessionShown=false;
  while(!controller.signal.aborted){this.owner(context.port,context.instanceId);
   if(Date.now()>=Date.parse(preparation.limits.expires_at))throw new Error('COMPUTER_PASS_ORIGINAL_SCOPE_EXPIRED');
   let execution:ManagedExecutionSnapshot;
   try{execution=this.identity(await context.port.readExecution(preparation.execution_id,controller.signal));}
   catch(error){if(/\bEXECUTION_CONTEXT_MISSING\b/.test(String(error))){await wait(this.intervalMs,controller.signal);continue;}throw error;}
   this.owner(context.port,context.instanceId);controller.signal.throwIfAborted();this.publish({execution});
   const delivered=execution.authority_active&&execution.status==='running'&&execution.pack.receipt.delivery==='delivered';
   if(delivered&&!reviewOpened){await this.hooks.authority?.(execution,controller.signal);reviewOpened=true;}
   if(!sessionShown&&delivered){try{const value=this.originalSession(await context.port.readComputerStatus(preparation.execution_id,preparation.id,controller.signal));
     this.owner(context.port,context.instanceId);controller.signal.throwIfAborted();this.hooks.session?.(context.port,context.instanceId,preparation.execution_id,preparation.id,value);sessionShown=true;
    }catch(error){if(!/\bCOMPUTER_SESSION_UNKNOWN\b/.test(String(error)))throw error;}}
   if(!execution.authority_active)return;await wait(this.intervalMs,controller.signal);
  }
 }
 async start(port:ComputerPassPort|undefined,instanceId:string,request:NativeComputerPassRequest):Promise<NativeComputerPassReply>{this.idle();const context=this.owner(port,instanceId),preparation=this.state.preparation;
  const captured=NativeComputerPassRequestSchema.parse(structuredClone(request));
  if(this.state.status!=='confirmed'||this.state.dispatched||!preparation||captured.computer_preparation_id!==preparation.id||!this.state.confirmation
   ||Date.now()>=Math.min(Date.parse(preparation.limits.expires_at),Date.parse(this.state.confirmation.expires_at)))throw new Error('COMPUTER_PASS_ORIGINAL_CONFIRMATION_REQUIRED');
  const controller=new AbortController(),monitor=new AbortController();this.run=controller;this.monitor=monitor;
  this.publish({status:'running',busy:true,dispatched:true,message:`Running original execution ${preparation.execution_id}. Tool effect reviews and Stop remain independent of the model.`});
  // Catch the RPC immediately. Monitoring errors cancel its wait; they never replay the model/input.
  const reply=context.port.runComputerPass(captured,preparation.execution_id,controller.signal);
  const monitoring=this.watch(context,preparation,monitor).catch(error=>{if(!monitor.signal.aborted){controller.abort(error);this.publish({message:`Original execution monitoring failed; inspect ${preparation.execution_id}. ${String(error)}`});}});
  try{const result=await reply;this.owner(port,instanceId);controller.signal.throwIfAborted();const execution=this.identity(result.execution);
   if(result.execution_id!==preparation.execution_id)throw new Error('COMPUTER_PASS_EXECUTION_OWNER_MISMATCH');
   this.publish({execution,status:closed(execution)?'settled':'unconfirmed',busy:false,message:`Original execution ${execution.execution_id}: ${execution.status}. ${closed(execution)?'Authority closed.':'Recovery or graph reconciliation is still required; no input replay.'}`});
   this.hooks.closure?.(execution);return result;
  }catch(error){this.publish({status:'unconfirmed',busy:false,message:`Pass reply unconfirmed for ${preparation.execution_id}. Inspect the original execution; do not repeat input. ${String(error)}`});throw error;}
  finally{monitor.abort();await monitoring;if(this.run===controller)this.run=undefined;if(this.monitor===monitor)this.monitor=undefined;}
 }
 async stop(){if(!this.state.dispatched){if(this.state.preparation&&this.state.status!=='settled'){const context=this.original();return this.cancel(context.port,context.instanceId,this.state.preparation.id);}
   this.pending?.abort(new Error('COMPUTER_PASS_OPERATOR_STOP'));return;}const preparation=this.state.preparation!,context=this.original();
  this.run?.abort(new Error('COMPUTER_PASS_OPERATOR_STOP'));this.monitor?.abort();
  this.publish({status:'recovering',message:'Stop requested on the original execution; physical acknowledgement and execution closure are separate.'});
  try{const value=this.originalSession(await context.port.controlComputer(preparation.execution_id,preparation.id,'stop'));this.original();
   this.hooks.session?.(context.port,context.instanceId,preparation.execution_id,preparation.id,value);
   this.publish({status:'unconfirmed',message:`Original worker: ${value.session.state}. Inspect execution closure; no model termination or graph reconciliation is inferred from this acknowledgement.`});
  }catch(error){this.publish({status:'unconfirmed',message:`Original Stop acknowledgement unconfirmed. Inspect ${preparation.execution_id}; no replacement worker. ${String(error)}`});throw error;}
 }
 async inspect(port:ComputerPassPort|undefined,instanceId:string){this.idle();const context=this.owner(port,instanceId),preparation=this.state.preparation;
  if(!preparation||!this.state.dispatched)throw new Error('COMPUTER_PASS_ORIGINAL_EXECUTION_REQUIRED');const controller=new AbortController();this.pending=controller;
  this.publish({status:'recovering',busy:true,message:'Inspecting the original execution; no model or input is repeated…'});
  try{const execution=this.identity(await context.port.readExecution(preparation.execution_id,controller.signal));this.owner(port,instanceId);controller.signal.throwIfAborted();
   this.publish({execution,status:closed(execution)?'settled':'unconfirmed',busy:false,message:`Original execution ${execution.execution_id}: ${execution.status}; authority ${execution.authority_active?'active':'closed'}. ${closed(execution)?'Closure read back.':'Keep this identity for recovery or reconciliation.'}`});
   this.hooks.closure?.(execution);return execution;
  }catch(error){this.publish({status:'unconfirmed',busy:false,message:`Original execution inspection unconfirmed. ${String(error)}`});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 ownerChanged(){this.pending?.abort(new Error('COMPUTER_PASS_OWNER_CHANGED'));this.run?.abort(new Error('COMPUTER_PASS_OWNER_CHANGED'));this.monitor?.abort();
  if(this.state.preparation&&this.state.status!=='settled')this.publish({status:'unconfirmed',message:`Owner changed. Return to ${this.context?.endpoint} / ${this.context?.instanceId} to inspect the retained original scope. No request is retargeted.`});
  else{this.generation++;this.context=undefined;this.state={status:'idle',dispatched:false,busy:false};this.emit(this.view);}}
 dispose(){this.ownerChanged();this.disposed=true;}
}
