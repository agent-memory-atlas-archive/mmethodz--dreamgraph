/** Actual compiled editor modules; VSCode UI/workspace APIs alone are declared doubles. */
const {createRequire}=require('node:module');
const {readFileSync}=require('node:fs');
const {readFile}=require('node:fs/promises');
const {dirname,resolve,sep}=require('node:path');
const vm=require('node:vm');
exports.compiledEditor=function compiledEditor(){
 const root=resolve(__dirname,'../../extensions/vscode/dist'),cache=new Map();
 const editor={ProgressLocation:{Notification:1},workspace:{getConfiguration:()=>({get:()=>undefined}),workspaceFolders:[],asRelativePath:file=>file,fs:{readFile:uri=>readFile(uri.fsPath)}},
  Uri:{file:file=>({fsPath:file,scheme:'file'})},window:{showInformationMessage:async()=>undefined,showWarningMessage:async()=>undefined,showErrorMessage:async()=>undefined},commands:{},languages:{}};
 const sandbox=vm.createContext({Buffer,process,console,Error,AbortController,AbortSignal,URL,TextDecoder,TextEncoder,structuredClone,
  fetch,Response,Headers,Request,ReadableStream,setTimeout,clearTimeout,setInterval,clearInterval});
 function load(filename){
  const existing=cache.get(filename);if(existing)return existing.exports;
  const module={exports:{}};cache.set(filename,module);const localRequire=createRequire(filename);
  const requirePort=id=>{if(id==='vscode')return editor;const resolved=localRequire.resolve(id);return resolved.startsWith(root+sep)&&resolved.endsWith('.js')?load(resolved):localRequire(id);};
  new vm.Script(`(function(exports,require,module,__filename,__dirname){${readFileSync(filename,'utf8')}\n})`,{filename,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})
   .runInContext(sandbox)(module.exports,requirePort,module,filename,dirname(filename));return module.exports;
 }
 const reviews=load(resolve(root,'change-review-service.js'));
 // No native editor is present; qualification can provide its own finite fixture path list.
 reviews.changeReviewService.listReviewableWorkspacePaths=async()=>[];
 return {editor,registerRunnerCommands:load(resolve(root,'local-tools.js')).registerRunnerCommands,
  runPassViaCore:load(resolve(root,'architect-core/runner.js')).runPassViaCore,
  createCoreProviderPort:load(resolve(root,'architect-core/adapters/v1.js')).createProviderPort,
  createCoreToolExecutorPort:load(resolve(root,'architect-core/adapters/v1.js')).createToolExecutorPort,
  ChatPanel:load(resolve(root,'chat-panel.js')).ChatPanel,changeReviewService:reviews.changeReviewService,ChangeReviewService:reviews.ChangeReviewService,
  managedReadOnlyModel:load(resolve(root,'managed-native-pass.js')).managedReadOnlyModel,
  ManagedNativePass:load(resolve(root,'managed-native-pass.js')).ManagedNativePass,DaemonClient:load(resolve(root,'daemon-client.js')).DaemonClient,
  ManagedModelSession:load(resolve(root,'managed-model-session.js')).ManagedModelSession,
  explainFileCommand:load(resolve(root,'commands.js')).explainFileCommand,checkAdrComplianceCommand:load(resolve(root,'commands.js')).checkAdrComplianceCommand,
  ArchitectLlm:load(resolve(root,'architect-llm.js')).ArchitectLlm,McpClient:load(resolve(root,'mcp-client.js')).McpClient};
};
