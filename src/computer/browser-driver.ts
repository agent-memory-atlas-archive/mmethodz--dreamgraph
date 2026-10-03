/** Constant executor-owned DOM operations. No model scripts, personal profile, clipboard, file transfers or native dialogs. */
import {createHash,randomUUID} from "node:crypto";
import {realpath,stat} from "node:fs/promises";
import type {Browser,BrowserContext,ElementHandle,Page} from "playwright-core";
import {computerDigest} from "./digest.js";
import {BrowserWorkerProfileSchema,browserUrlAllowed,redactBrowserText,type BrowserWorkerProfile} from "./browser-profile.js";
import type {ComputerAction,ComputerTarget,ComputerWorkerObservation} from "./worker-port.js";
type ElementState={profile_id:string;ref:string;tag:string;role:string;label:string;text:string;value:string;enabled:boolean;visible:boolean;sensitive:boolean;box:{x:number;y:number;width:number;height:number}|null};
export class BrowserComputerDriver {
  private browser?:Browser;private launching?:Promise<Browser>;private context?:BrowserContext;private page?:Page;private target?:ComputerTarget;
  private controller=new AbortController();private closing?:Promise<void>;private refs=new Map<string,{handle:ElementHandle;state:ElementState}>();
  private fingerprint?:string;private generation=1;private actions=0;private images=0;private imageBytes=0;private observationTime=0;private blockedDialog=false;private paused=false;
  readonly profile:BrowserWorkerProfile;
  constructor(input:BrowserWorkerProfile,readonly epoch:string){this.profile=BrowserWorkerProfileSchema.parse(input);}
  private check(signal?:AbortSignal){this.controller.signal.throwIfAborted();signal?.throwIfAborted();if(this.paused)throw new Error("COMPUTER_BROWSER_PAUSED");
    if(Date.parse(this.profile.expires_at)<=Date.now())throw new Error("COMPUTER_BROWSER_DEADLINE");}
  async open(target:ComputerTarget,signal:AbortSignal){
    this.check(signal);if(this.browser||this.target)throw new Error("COMPUTER_BROWSER_ALREADY_OPEN");
    if(target.surface!=="browser"||target.origin!==this.profile.main_origin)throw new Error("COMPUTER_BROWSER_TARGET_REJECTED");
    this.target=structuredClone(target);this.generation=target.generation;
    const executable=await realpath(this.profile.browser_executable);if(!(await stat(executable)).isFile())throw new Error("COMPUTER_BROWSER_EXECUTABLE_UNAVAILABLE");
    const {chromium}=await import("playwright-core");
    this.check(signal);this.launching=chromium.launch({executablePath:executable,headless:true,chromiumSandbox:true,handleSIGTERM:true,timeout:15000,
      args:["--force-webrtc-ip-handling-policy=disable_non_proxied_udp","--disable-features=WebTransport,DirectSockets,WebBluetooth,WebUSB"]});
    this.browser=await this.launching;
    try{
      this.check(signal);if(this.browser.version()!==this.profile.browser_version)throw new Error("COMPUTER_BROWSER_VERSION_UNQUALIFIED");
      this.context=await this.browser.newContext({acceptDownloads:false,serviceWorkers:"block",permissions:[],viewport:{width:1280,height:800},deviceScaleFactor:1});
      this.context.setDefaultTimeout(this.profile.action_timeout_ms);this.context.setDefaultNavigationTimeout(this.profile.action_timeout_ms);
      await this.context.addInitScript(()=>{
        for(const name of ["RTCPeerConnection","webkitRTCPeerConnection","WebTransport","Worker","SharedWorker"])
          try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});}catch{}
      });
      await this.context.routeWebSocket("**/*",socket=>socket.close());
      await this.context.route("**/*",async route=>{
        try{
          const request=route.request(),frame=request.frame();
          if(this.controller.signal.aborted||frame.page()!==this.page||frame!==this.page?.mainFrame()
            ||!browserUrlAllowed(this.profile,request.url(),request.method(),request.isNavigationRequest())){await route.abort("blockedbyclient");return;}
          // Do not allow an unchecked redirect to run inside the executor's HTTP client.
          const response=await route.fetch({maxRedirects:0,timeout:this.profile.action_timeout_ms});
          const headers=response.headers(),location=headers.location;
          if(location&&response.status()>=300&&response.status()<400&&!browserUrlAllowed(this.profile,new URL(location,request.url()).href,"GET",request.isNavigationRequest())){
            await route.abort("blockedbyclient");return;}
          if(request.isNavigationRequest())headers["content-security-policy"]=(headers["content-security-policy"]?headers["content-security-policy"]+", ":"")
            +`connect-src ${this.profile.network.map(rule=>rule.origin).join(" ")}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action ${this.profile.main_origin}`;
          await route.fulfill({response,headers});
        }catch{await route.abort("blockedbyclient").catch(()=>{});}
      });
      this.context.on("page",page=>{if(this.page&&page!==this.page)void page.close().catch(()=>{});});
      this.check(signal);this.page=await this.context.newPage();this.check(signal);
      this.page.on("dialog",dialog=>{this.blockedDialog=true;void dialog.dismiss().catch(()=>{});});
      this.page.on("filechooser",chooser=>{void chooser.setFiles([]).catch(()=>{});});
      this.page.on("download",download=>{void download.cancel().catch(()=>{});});
      await this.page.goto(this.profile.initial_url,{waitUntil:"domcontentloaded"});this.check(signal);
    }catch(error){await this.stop();throw error;}
  }
  private async states(){
    if(!this.page||this.page.isClosed())throw new Error("COMPUTER_BROWSER_TARGET_CLOSED");
    if(!browserUrlAllowed(this.profile,this.page.url(),"GET",true))throw new Error("COMPUTER_BROWSER_ORIGIN_DENIED");
    const output:Array<{handle:ElementHandle;state:ElementState}>=[];
    for(const definition of this.profile.elements){const locator=this.page.locator(definition.selector);
      if(await locator.count()!==1)continue;const handle=await locator.elementHandle();if(!handle)continue;
      const data=await handle.evaluate((element,{readText,readValue})=>{
        const input=element as HTMLInputElement,style=getComputedStyle(element),rect=element.getBoundingClientRect();
        const sensitive=/password|secret|token|otp|one.time|credit|card.number|cc-number|api.key/i.test([element.getAttribute("type"),element.getAttribute("autocomplete"),element.getAttribute("name"),element.getAttribute("aria-label")].join(" "))||input.type==="file";
        const hit=rect.width>0&&rect.height>0?document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2):null;
        return {tag:element.tagName.toLowerCase(),role:element.getAttribute("role")??"",label:element.getAttribute("aria-label")??"",
          text:readText&&!sensitive?(element.textContent??"").slice(0,2048):"",value:readValue&&!sensitive&&typeof input.value==="string"?input.value.slice(0,4096):"",
          enabled:!input.disabled&&element.getAttribute("aria-disabled")!=="true",visible:style.visibility!=="hidden"&&style.display!=="none"&&Number(style.opacity)>0&&!!hit&&(hit===element||element.contains(hit)),sensitive,
          box:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};
      },{readText:definition.read_text,readValue:definition.read_value});
      for(const name of ["label","text","value"] as const)data[name]=redactBrowserText(this.profile,data[name]);
      output.push({handle,state:{...data,profile_id:definition.id,ref:"",box:await handle.boundingBox()}});
    }
    return output;
  }
  private hash(states:Array<{state:ElementState}>){return computerDigest({url:this.page!.url(),viewport:this.page!.viewportSize(),dialog:this.blockedDialog,
    states:states.map(({state})=>({...state,ref:""}))});}
  async observe(signal:AbortSignal):Promise<ComputerWorkerObservation>{
    this.check(signal);this.reserveCapture();const values=await this.states(),fingerprint=this.hash(values);
    if(this.fingerprint&&this.fingerprint!==fingerprint)this.generation++;
    for(const item of this.refs.values())await item.handle.dispose().catch(()=>{});this.refs.clear();
    for(const value of values){value.state.ref=`element:${randomUUID()}`;this.refs.set(value.state.ref,value);}
    this.fingerprint=fingerprint;this.observationTime=Date.now();
    const url=new URL(this.page!.url()),summary=JSON.stringify({origin:url.origin,path:redactBrowserText(this.profile,url.pathname),generation:this.generation,
      blocked_dialog:this.blockedDialog,elements:values.map(({state})=>{const {profile_id,sensitive,...visible}=state;return {...visible,sensitive};})});
    if(Buffer.byteLength(summary,"utf8")>this.profile.observation_bytes)throw new Error("COMPUTER_BROWSER_OBSERVATION_CAPACITY");
    let image:ComputerWorkerObservation["image"];
    if(this.profile.images.enabled){const region=this.page!.locator(this.profile.images.region!);
      if(await region.count()!==1)throw new Error("COMPUTER_BROWSER_CAPTURE_SCOPE_AMBIGUOUS");
      const selectors=["input","textarea","iframe","[data-dg-private]","[autocomplete*=password]","[autocomplete=one-time-code]",...this.profile.images.mask_selectors];
      const bytes=await region.screenshot({type:"png",animations:"disabled",caret:"hide",mask:[...selectors.map(selector=>this.page!.locator(selector)),...this.profile.redactions.map(secret=>this.page!.getByText(secret))]});
      if(bytes.length>this.profile.images.max_bytes)throw new Error("COMPUTER_BROWSER_IMAGE_CAPACITY");image={mime_type:"image/png",bytes};
      this.images++;this.imageBytes+=bytes.length;
    }
    this.check(signal);return {epoch:this.epoch,target:{...this.target!,generation:this.generation},kind:"dom",summary,content_hash:computerDigest({fingerprint,summary}),captured_at:new Date().toISOString(),
      ...(image?{image:{...image,content_hash:"sha256:"+createHash("sha256").update(image.bytes).digest("hex")}}:{})};
  }
  private reserveCapture(){if(this.profile.images.enabled&&(this.images>=this.profile.images.max_count||this.imageBytes+this.profile.images.max_bytes>this.profile.images.total_bytes))throw new Error("COMPUTER_BROWSER_IMAGE_RESERVATION_EXHAUSTED");}
  async act(action:ComputerAction,signal:AbortSignal){
    this.check(signal);this.reserveCapture();if(++this.actions>this.profile.max_actions)throw new Error("COMPUTER_BROWSER_ACTION_CAPACITY");
    const post=this.profile.postconditions.find(item=>item.id===action.postcondition);if(!post)throw new Error("COMPUTER_BROWSER_POSTCONDITION_UNREVIEWED");
    if(action.target_id!==this.target?.id||action.target_generation!==this.generation||Date.now()-this.observationTime>20000)throw new Error("COMPUTER_BROWSER_OBSERVATION_STALE");
    const current=await this.states(),same=this.hash(current)===this.fingerprint;
    for(const item of current)await item.handle.dispose().catch(()=>{});
    if(!same||this.blockedDialog)return {input_delivered:false,postcondition_met:false,observation:await this.observe(signal)};
    const selected=action.parameters.locator?this.refs.get(action.parameters.locator):undefined;
    const definition=selected?this.profile.elements.find(item=>item.id===selected.state.profile_id):undefined;
    if(action.operation!=="navigate"&&(!selected||!definition||!definition.operations.includes(action.operation as never)||!selected.state.visible||!selected.state.enabled||selected.state.sensitive))
      throw new Error("COMPUTER_BROWSER_ELEMENT_REJECTED");
    this.check(signal);const element=selected?.handle!,p=action.parameters;
    switch(action.operation){
      case "navigate":if(!this.profile.navigation||!p.url||!browserUrlAllowed(this.profile,p.url,"GET",true))throw new Error("COMPUTER_BROWSER_NAVIGATION_DENIED");
        await this.page!.goto(p.url,{waitUntil:"domcontentloaded"});break;
      case "click":await element.click({timeout:this.profile.action_timeout_ms});break;
      case "type":if(typeof p.text!=="string"||Buffer.byteLength(p.text)>16384)throw new Error("COMPUTER_BROWSER_TEXT_BOUND");await element.fill(p.text);break;
      case "key":if(!p.key||!["Enter","Tab","Escape","Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","Backspace","Delete"].includes(p.key))throw new Error("COMPUTER_BROWSER_KEY_DENIED");await element.press(p.key);break;
      case "select":if(p.value===undefined)throw new Error("COMPUTER_BROWSER_VALUE_REQUIRED");await element.selectOption(p.value);break;
      case "set_checked":if(p.checked===undefined)throw new Error("COMPUTER_BROWSER_VALUE_REQUIRED");await element.setChecked(p.checked);break;
      case "focus":await element.focus();break;
      case "scroll":if(!Number.isFinite(p.delta_y)||Math.abs(p.delta_y!)>1000||Math.abs(p.delta_x??0)>1000)throw new Error("COMPUTER_BROWSER_SCROLL_BOUND");
        await element.evaluate((value,{x,y})=>(value as HTMLElement).scrollBy(x,y),{x:p.delta_x??0,y:p.delta_y!});break;
      default:throw new Error("COMPUTER_BROWSER_OPERATION_UNSUPPORTED");
    }
    this.check(signal);let verified=false;
    if(post.kind==="url_equals")verified=this.page!.url()===post.expected;
    else{const locator=this.page!.locator(post.selector!);if(await locator.count()===1){
      switch(post.kind){case "value_equals_input":verified=await locator.inputValue()===p.text;break;
        case "checked_equals_input":verified=await locator.isChecked()===p.checked;break;
        case "text_equals":verified=await locator.textContent()===post.expected;break;
        case "visible":verified=await locator.isVisible();break;}
    }}
    return {input_delivered:true,postcondition_met:verified,observation:await this.observe(signal)};
  }
  async pause(){this.check();if(!this.page||this.page.isClosed())throw new Error("COMPUTER_BROWSER_TARGET_CLOSED");
    // Structured operations are atomic and never leave a held key/button. The
    // broker drains an operation before this observed-boundary acknowledgement.
    this.paused=true;this.refs.clear();this.observationTime=0;return {epoch:this.epoch,input_released:true,paused:true};}
  async resume(target:ComputerTarget,signal:AbortSignal){this.controller.signal.throwIfAborted();signal.throwIfAborted();
    if(!this.paused||!this.target||target.id!==this.target.id||target.host_id!==this.target.host_id||target.instance_id!==this.target.instance_id||target.session_id!==this.target.session_id)throw new Error("COMPUTER_BROWSER_RESUME_REJECTED");
    this.paused=false;this.generation++;this.fingerprint=undefined;return this.observe(signal);}
  async releaseInput(){
    this.controller.abort(new Error("COMPUTER_BROWSER_STOP"));this.refs.clear();this.observationTime=0;
    // This backend never holds the native desktop seat. Close the actual input
    // target, without beforeunload code, before attesting release of virtual input.
    // A delivered remote effect may still finish; this is not termination proof.
    const page=this.page;
    if(page&&!page.isClosed())await page.close({runBeforeUnload:false}).catch(error=>{if(!page.isClosed())throw error;});
    return {epoch:this.epoch,input_released:true};
  }
  async stop(){
    if(!this.closing){this.controller.abort(new Error("COMPUTER_BROWSER_STOP"));this.closing=(async()=>{
      // A dedicated browser owns every context and page; there is no shared personal browser to close.
      const browser=await this.launching?.catch(()=>undefined)??this.browser;
      // Browser/input revocation must start immediately, even with a pending
      // routed HTTP request. Dispose that executor concurrently, not as a queue
      // in front of physical browser termination.
      await Promise.all([this.context?.request.dispose(),browser?.close({reason:"Computer worker local stop"})]);
      this.refs.clear();this.page=undefined;this.context=undefined;this.browser=undefined;
    })();}
    await this.closing;return {epoch:this.epoch,input_released:true,terminated:true};
  }
}
