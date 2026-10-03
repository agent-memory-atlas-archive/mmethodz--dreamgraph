/** Actual compiled editor HTML/bundle in Chrome. VSCode host messages are explicit doubles. */
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compiledEditor} from '../tests/helpers/compiled-editor.ts';
const {chromium}=await import(pathToFileURL(process.env.ASHOKA_PLAYWRIGHT_MODULE).href);
const out=resolve(process.env.ASHOKA_EDITOR_OPERATOR_QUALIFICATION_DIR||'docs/ashoka/editor-operator-browser');
await mkdir(out,{recursive:true});
const report={scope:'Actual compiled editor HTML and webview bundle in Windows Chrome; host messages/VSCode shell are declared doubles, no native editor/model/other-platform claim',checks:[]},errors=[];
let browser,panel;
try{
 const {ChatPanel}=compiledEditor();panel=new ChatPanel({extensionPath:resolve('extensions/vscode')});
 panel._webviewBundleUri='https://editor-assets.local/webview.js';
 let html=panel.getHtml({cspSource:'https://editor-assets.local'});
 const nonce=html.match(/nonce="([^"]+)"/)[1];
 html=html.replace('<head>',`<head><script nonce="${nonce}">window.architectHostMessages=[];let state={};window.acquireVsCodeApi=()=>({postMessage:message=>window.architectHostMessages.push(message),getState:()=>state,setState:value=>state=value});</script>`)
  .replace('<style>','<style>:root{--vscode-font-family:system-ui;--vscode-font-size:12px;--vscode-foreground:#ddd;--vscode-editor-background:#181818;--vscode-sideBar-background:#202020;--vscode-panel-border:#444;--vscode-input-background:#252525;--vscode-input-foreground:#ddd;--vscode-focusBorder:#80a7d6;--vscode-textLink-foreground:#9dc1ee}');
 browser=await chromium.launch({executablePath:process.env.ASHOKA_BROWSER_EXECUTABLE,headless:true});report.browser=await browser.version();
 const page=await browser.newPage({viewport:{width:720,height:850},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(String(error)));
 const bundle=await readFile('extensions/vscode/dist/webview.js','utf8');
 await page.route('https://editor-assets.local/webview.js',route=>route.fulfill({contentType:'text/javascript',body:bundle}));
 await page.setContent(html);await page.locator('#prompt').waitFor();
 assert.equal(await page.evaluate(()=>typeof window.renderMarkdown),'function');
 const rendered=await page.evaluate(()=>window.renderMarkdown('**Qualified renderer**\n<script>window.modelExecuted=true</script>'));
 assert.ok(rendered.includes('<strong>Qualified renderer</strong>'));assert.equal(await page.evaluate(()=>window.modelExecuted),undefined);
 report.checks.push({name:'E25-05',detail:'Actual packaged bundle installs its renderer under the unchanged nonce CSP, formats Markdown and keeps source HTML literal; no runtime eval.'});
 const send=data=>page.evaluate(data=>new Promise(done=>{const listener=event=>{if(event.data?.type===data.type){window.removeEventListener('message',listener);done();}};window.addEventListener('message',listener);window.postMessage(data,'*');}),data);
 const reviews=[{reviewId:'review-original',filePath:'C:/project/source.ts',relativePath:'source.ts',status:'pending',baselineKind:'existing',currentKind:'existing',updatedAt:1,addedLines:4,deletedLines:2,previewLines:[],recoveryRequired:false}];
 await page.locator('#prompt').fill('A draft that must survive operator actions 🌿');
 await send({type:'pendingReviews',reviews,collapsed:false});
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 assert.deepEqual((await page.evaluate(()=>window.architectHostMessages)).filter(message=>message.type==='undoPendingReview'),[{type:'undoPendingReview',filePath:reviews[0].filePath,reviewId:'review-original'}]);
 await send({type:'operatorExecution',active:true});
 assert.equal(await page.locator('#prompt').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Keep',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'Stop',exact:true}).click();assert.ok((await page.evaluate(()=>window.architectHostMessages)).some(message=>message.type==='stop'));
 await send({type:'operatorExecution',active:false});assert.equal(await page.locator('#prompt').isDisabled(),false);
 assert.equal(await page.locator('#prompt').inputValue(),'A draft that must survive operator actions 🌿');
 report.checks.push({name:'E25-03',detail:'Compiled production UI sends captured file/review identity, disables competing actions while an operator owns execution, keeps Stop available and retains the composer draft.'});
 await send({type:'pendingReviews',reviews:[{...reviews[0],status:'conflict',recoveryRequired:true,recoveryCanCheck:true}],collapsed:false});
 const recovery={executionId:'original-operator',authority:{endpoint:'http://127.0.0.1:8010',instanceId:'original-instance'},canCheck:true,message:'Acknowledgement unconfirmed. Check the original execution; do not repeat work.'};
 await send({type:'operatorExecution',active:false,recovery});
 assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Keep',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Check Undo outcome',exact:true}).focus();await page.keyboard.press('Enter');
 assert.deepEqual((await page.evaluate(()=>window.architectHostMessages)).filter(message=>message.type==='recoverPendingReview'),[{type:'recoverPendingReview',filePath:reviews[0].filePath,reviewId:'review-original'}]);
 await page.getByRole('button',{name:'Check outcome',exact:true}).click();
 assert.deepEqual((await page.evaluate(()=>window.architectHostMessages)).filter(message=>message.type==='recoverOperatorExecution'),[{type:'recoverOperatorExecution',executionId:'original-operator'}]);
 await send({type:'operatorExecution',active:false,recovery:{...recovery,canCheck:false}});assert.equal(await page.getByRole('button',{name:'Check outcome',exact:true}).isDisabled(),true);
 await send({type:'pendingReviews',reviews:[{...reviews[0],status:'conflict',recoveryRequired:true,recoveryCanCheck:false}],collapsed:false});
 assert.equal(await page.getByRole('button',{name:'Check Undo outcome',exact:true}).isDisabled(),true);
 assert.equal(await page.locator('#prompt').inputValue(),'A draft that must survive operator actions 🌿');
 await page.screenshot({path:join(out,'editor-operator-recovery.png')});
 await send({type:'operatorExecution',active:false});await page.locator('#operator-recovery').waitFor({state:'hidden'});
 report.checks.push({name:'E25-04',detail:'Unconfirmed Undo visibly disables Keep/Undo, offers keyboard-accessible original-ID readback, refuses a foreign binding, and retains the draft. Host outcome replies remain declared doubles.'});
 assert.deepEqual(errors,[]);report.pageErrors=errors;report.success=true;
}catch(error){report.success=false;report.failure=String(error.stack||error);throw error;}
finally{await writeFile(join(out,'qualification.json'),JSON.stringify(report,null,2));await browser?.close();panel?.dispose();}
