/** Operator-owned closed profiles. Page labels and model output cannot expand them. */
import {z} from "zod";
const id=z.string().min(1).max(256),selector=z.string().min(1).max(1024);
const origin=z.string().url().refine(value=>{const url=new URL(value);return ["http:","https:"].includes(url.protocol)&&value===url.origin;},"Use an exact HTTP(S) origin without credentials, path or query.");
export const BrowserWorkerProfileSchema=z.object({schema:z.literal("dreamgraph.browser_worker_profile.v1"),id,
  browser_executable:z.string().min(1).max(4096),browser_version:id,runtime_version:z.literal("1.62.1"),
  initial_url:z.string().url().max(4096),main_origin:origin,main_path_prefix:z.string().startsWith("/").max(1024),
  navigation:z.boolean().default(false),
  network:z.array(z.object({origin,path_prefix:z.string().startsWith("/").max(1024),methods:z.array(z.enum(["GET","HEAD","POST","PUT","PATCH","DELETE"])).min(1).max(6),allow_query:z.boolean().default(false)}).strict()).min(1).max(32),
  blocked_origins:z.array(origin).max(32),
  elements:z.array(z.object({id,selector,read_text:z.boolean(),read_value:z.boolean(),
    operations:z.array(z.enum(["click","type","key","scroll","select","set_checked","focus"])).max(7)}).strict()).min(1).max(64),
  postconditions:z.array(z.object({id,selector:selector.optional(),kind:z.enum(["value_equals_input","checked_equals_input","text_equals","visible","url_equals"]),expected:z.string().max(4096).optional()}).strict()).min(1).max(64),
  observation_bytes:z.number().int().min(1024).max(65536),action_timeout_ms:z.number().int().min(100).max(30000),
  max_actions:z.number().int().min(1).max(100),expires_at:z.string().datetime({offset:true}),
  images:z.object({enabled:z.boolean(),region:selector.nullable(),mask_selectors:z.array(selector).max(64),max_bytes:z.number().int().min(0).max(10*1024*1024),
    max_count:z.number().int().min(0).max(1000),total_bytes:z.number().int().min(0).max(100*1024*1024)}).strict(),
  redactions:z.array(z.string().min(3).max(4096)).max(128),
}).strict().superRefine((value,ctx)=>{
  const initial=new URL(value.initial_url);
  if(initial.origin!==value.main_origin||!browserUrlAllowed(value,value.initial_url,"GET",true)||initial.username||initial.password||initial.search)
    ctx.addIssue({code:z.ZodIssueCode.custom,path:["initial_url"],message:"Initial URL must be within the exact main scope, with no credentials/query."});
  if(value.blocked_origins.includes(value.main_origin))ctx.addIssue({code:z.ZodIssueCode.custom,path:["main_origin"],message:"An authority origin cannot be a computer target."});
  if(value.images.enabled&&(!value.images.region||!value.images.max_bytes||!value.images.max_count||value.images.total_bytes<value.images.max_bytes))ctx.addIssue({code:z.ZodIssueCode.custom,path:["images"],message:"Images require a named capture region and finite count/byte reservation."});
  if(new Set(value.elements.map(item=>item.id)).size!==value.elements.length||new Set(value.postconditions.map(item=>item.id)).size!==value.postconditions.length)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:"Element and postcondition IDs must be unique."});
  for(const post of value.postconditions)if(post.kind!=="url_equals"&&!post.selector||["text_equals","url_equals"].includes(post.kind)&&post.expected===undefined)
    ctx.addIssue({code:z.ZodIssueCode.custom,path:["postconditions"],message:"Postconditions require their structural selector and expected state."});
});
export type BrowserWorkerProfile=z.infer<typeof BrowserWorkerProfileSchema>;
const withinPath=(path:string,prefix:string)=>prefix==="/"||path===prefix||path.startsWith(prefix.endsWith("/")?prefix:prefix+"/");
export function browserUrlAllowed(profile:BrowserWorkerProfile,input:string,method:string,main=false){
  try{const url=new URL(input);if(!["http:","https:"].includes(url.protocol)||url.username||url.password||profile.blocked_origins.includes(url.origin))return false;
    if(main&&(url.origin!==profile.main_origin||!withinPath(url.pathname,profile.main_path_prefix)))return false;
    const pathname=decodeURIComponent(url.pathname);if(pathname.includes("\\")||pathname.split("/").includes(".."))return false;
    return profile.network.some(rule=>rule.origin===url.origin&&withinPath(pathname,rule.path_prefix)&&rule.methods.includes(method as never)&&(!url.search||rule.allow_query));
  }catch{return false;}
}
export function redactBrowserText(profile:BrowserWorkerProfile,input:string){let value=input;
  for(const secret of profile.redactions)value=value.split(secret).join("[redacted]");
  return value.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+[a-zA-Z0-9._~+/-]{12,})\b/g,"[redacted]");
}
