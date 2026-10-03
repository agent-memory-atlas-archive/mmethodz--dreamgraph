/** Original editor owner only. No provider execution, preparation, grants or physical input. */
import type {ComputerOperatorPort,ComputerOperatorSnapshot,ComputerEvidence} from '@dreamgraph/sdk/seams/computer-control' with {"resolution-mode":"import"};
export interface ComputerControlView {status:'idle'|'loading'|'ready'|'controlling'|'unconfirmed'|'error';endpoint?:string;instanceId?:string;
 sessions:ComputerOperatorSnapshot[];selected?:ComputerOperatorSnapshot;nextCursor?:string|null;snapshotHash?:string;message?:string;evidence?:ComputerEvidence;evidenceLoading?:boolean;evidenceMessage?:string;}
type Context={port:ComputerOperatorPort;endpoint:string;instanceId:string};
export class ComputerControlController {
 private context?:Context;private generation=0;private pending?:AbortController;private control?:AbortController;
 private evidenceGeneration=0;private evidencePending?:AbortController;
 private view:ComputerControlView={status:'idle',sessions:[]};
 constructor(private emit:(view:ComputerControlView)=>void){}
 private publish(value:Partial<ComputerControlView>){this.view={...this.view,...value};this.emit(structuredClone(this.view));}
 private assertContext(port:ComputerOperatorPort|undefined,instanceId:string){const context=this.context;
  if(!context||!port||context.port!==port||port.baseUrl!==context.endpoint||instanceId!==context.instanceId)throw new Error('COMPUTER_EDITOR_OWNER_CHANGED');return context;}
 private validate(value:ComputerOperatorSnapshot,context:Context,id?:string){if(value.session.instance_id!==context.instanceId||id&&value.session.id!==id)throw new Error('COMPUTER_EDITOR_REPLY_OWNER_MISMATCH');return value;}
 clearEvidence(){this.evidenceGeneration++;this.evidencePending?.abort();this.evidencePending=undefined;this.publish({evidence:undefined,evidenceLoading:false,evidenceMessage:undefined});}
 async inspectEvidence(port:ComputerOperatorPort|undefined,instanceId:string,id:string){
  const context=this.assertContext(port,instanceId),selected=this.view.selected;
  if(!selected||selected.session.id!==id||this.pending||this.control||!context.port.readComputerEvidence)throw new Error('COMPUTER_EDITOR_EVIDENCE_TARGET_REQUIRED');
  this.clearEvidence();const generation=this.evidenceGeneration,controller=new AbortController();this.evidencePending=controller;
  this.publish({evidenceLoading:true,evidenceMessage:'Reading existing original-session evidence; no new capture or input…'});
  try{const evidence=await context.port.readComputerEvidence(selected.session.execution_id,id,controller.signal);
   if(generation!==this.evidenceGeneration)return;this.assertContext(port,instanceId);
   if(evidence.instance_id!==instanceId||evidence.execution_id!==selected.session.execution_id||evidence.computer_session_id!==id||evidence.fence!==selected.session.fence
    ||evidence.observation&&!selected.targets.some(target=>target.id===evidence.observation!.observation.target_id&&target.generation===evidence.observation!.observation.target_generation))throw new Error('COMPUTER_EDITOR_EVIDENCE_OWNER_MISMATCH');
   this.publish({evidence,evidenceLoading:false,evidenceMessage:evidence.observation?(evidence.observation.expired?'Expired evidence, shown for inspection only; no live coordinates.':'Original evidence; GUI state is separate from graph reconciliation and slice verification.'):
    'No ephemeral observation is available from the original worker. No replacement worker or new capture is created.'});
  }catch(error){if(generation===this.evidenceGeneration)this.publish({evidence:undefined,evidenceLoading:false,evidenceMessage:String(error)});throw error;}
  finally{if(this.evidencePending===controller)this.evidencePending=undefined;}
 }
 async refresh(port:ComputerOperatorPort|undefined,instanceId:string,more=false){
  if(this.control)throw new Error('COMPUTER_EDITOR_CONTROL_PENDING');if(!port||!instanceId||instanceId==='default')throw new Error('COMPUTER_EDITOR_INSTANCE_REQUIRED');
  const context=more?this.assertContext(port,instanceId):{port,endpoint:port.baseUrl,instanceId};
  if(more&&!this.view.nextCursor)return;if(more&&!this.view.snapshotHash)throw new Error('COMPUTER_EDITOR_PAGE_SNAPSHOT_REQUIRED');
  const page=more?{cursor:this.view.nextCursor!,snapshot_hash:this.view.snapshotHash!}:undefined;
  const selected=this.context?.port===port&&this.context.endpoint===context.endpoint&&this.context.instanceId===instanceId?this.view.selected:undefined;
  this.clearEvidence();
  this.pending?.abort();const controller=new AbortController(),generation=++this.generation;this.pending=controller;this.context=context;
  if(!more)this.view={status:'loading',sessions:[],selected,endpoint:context.endpoint,instanceId};this.publish({status:'loading',message:'Reading this editor owner’s original sessions…'});
  try{const result=await port.listComputerSessions(page,controller.signal);
   if(generation!==this.generation)return;this.assertContext(port,instanceId);const sessions=[...(more?this.view.sessions:[]),...result.sessions.map(value=>this.validate(value,context))];
   if(new Set(sessions.map(value=>value.session.id)).size!==sessions.length)throw new Error('COMPUTER_EDITOR_SESSION_PAGE_CHANGED');
   this.publish({status:'ready',sessions,nextCursor:result.next_cursor,snapshotHash:result.snapshot_hash,message:sessions.length?'Select an original session to inspect its scope and controls.':
    'This editor owner has no computer sessions. Browser owners remain separate. Use the explicit daemon API pass to prepare a new scoped session.'});
  }catch(error){if(generation===this.generation)this.publish({status:'error',message:String(error)});throw error;}
  finally{if(this.pending===controller)this.pending=undefined;}
 }
 async select(port:ComputerOperatorPort|undefined,instanceId:string,id:string){const context=this.assertContext(port,instanceId),listed=this.view.sessions.find(value=>value.session.id===id);
  if(!listed)throw new Error('COMPUTER_EDITOR_UNLISTED_SESSION');if(this.control)throw new Error('COMPUTER_EDITOR_CONTROL_PENDING');
  this.clearEvidence();
  this.pending?.abort();const controller=new AbortController(),generation=++this.generation;this.pending=controller;
  this.publish({status:'loading',message:'Reading the captured original target…'});
  try{const selected=await context.port.readComputerStatus(listed.session.execution_id,id,controller.signal);if(generation!==this.generation)return;
   this.assertContext(port,instanceId);this.validate(selected,context,id);if(selected.session.execution_id!==listed.session.execution_id)throw new Error('COMPUTER_EDITOR_REPLY_OWNER_MISMATCH');
   this.publish({status:'ready',selected,message:selected.worker_available?'Original worker controls; selection grants no authority.':'Original worker unavailable. Durable status is retained; no replacement or input replay.'});
  }catch(error){if(generation===this.generation)this.publish({status:'error',message:String(error)});throw error;}finally{if(this.pending===controller)this.pending=undefined;}
 }
 async act(port:ComputerOperatorPort|undefined,instanceId:string,id:string,action:'pause'|'resume'|'stop'|'recover-stop'){
  const context=this.assertContext(port,instanceId),selected=this.view.selected;
  if(!selected||selected.session.id!==id||!['pause','resume','stop','recover-stop'].includes(action))throw new Error('COMPUTER_EDITOR_CONTROL_TARGET_REQUIRED');
  if(this.control&&action!=='stop'&&action!=='recover-stop')throw new Error('COMPUTER_EDITOR_CONTROL_PENDING');
  this.clearEvidence();
  // Stop is independent of an outstanding inspection/pause/resume wait.
  this.pending?.abort();this.control?.abort();const controller=new AbortController(),generation=++this.generation;this.control=controller;
  this.publish({status:'controlling',message:`${action}: waiting for the original worker acknowledgement…`});
  try{const result=await context.port.controlComputer(selected.session.execution_id,id,action,selected.session.fence,controller.signal);
   if(generation!==this.generation)return;this.assertContext(port,instanceId);this.validate(result,context,id);
   if(result.session.execution_id!==selected.session.execution_id)throw new Error('COMPUTER_EDITOR_REPLY_OWNER_MISMATCH');
   this.publish({status:'ready',selected:result,message:'Original control state acknowledged. GUI success is separate from graph reconciliation and slice verification.'});
  }catch(error){if(generation===this.generation)this.publish({status:'unconfirmed',message:`Control reply unconfirmed: ${String(error)}. Inspect the original state; no new pass or input replay.`});throw error;}
  finally{if(this.control===controller)this.control=undefined;}
 }
 /** Only a session returned by this owner's explicit preparation may enter without a listing. */
 trackOriginalSession(port:ComputerOperatorPort,instanceId:string,executionId:string,id:string,value:ComputerOperatorSnapshot){
  if(!instanceId||instanceId==='default'||this.control)throw new Error('COMPUTER_EDITOR_CONTROL_PENDING_OR_INSTANCE_REQUIRED');
  const context={port,endpoint:port.baseUrl,instanceId};this.validate(value,context,id);
  if(value.session.execution_id!==executionId)throw new Error('COMPUTER_EDITOR_REPLY_OWNER_MISMATCH');
  this.clearEvidence();this.pending?.abort();this.pending=undefined;this.generation++;this.context=context;
  this.view={status:'ready',endpoint:context.endpoint,instanceId,sessions:[value],selected:value,nextCursor:null,
   message:'Original session from this editor’s explicit daemon API pass. Refresh to discover other owned sessions.'};this.publish({});
 }
 dispose(){this.clearEvidence();this.generation++;this.pending?.abort();this.control?.abort();this.pending=undefined;this.control=undefined;this.context=undefined;
  this.view={status:'idle',sessions:[]};this.emit(structuredClone(this.view));}
}
