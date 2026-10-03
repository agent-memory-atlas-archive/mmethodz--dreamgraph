/** Bounded qualification diagnostics; no model request or physical runtime claim. */
import {afterEach,it,expect,vi} from 'vitest';
import {BrowserHarnessWorker} from '../src/computer/browser-harness.js';
import {browserQualificationFailureDetails,qualifyBrowserRuntime} from '../src/computer/qualify-browser.js';
afterEach(()=>vi.restoreAllMocks());
it('a failed real qualification boundary retains only known worker phase and completed check IDs',async()=>{
 vi.spyOn(BrowserHarnessWorker,'create').mockRejectedValue(new Error('COMPUTER_WORKER_REPLY_UNKNOWN',
  {cause:{phase:'bootstrap',nonce:'SYNTHETIC_SECRET',payload:'SYNTHETIC_SECRET'}}));
 let error:unknown;
 try{await qualifyBrowserRuntime({browser_executable:process.execPath,browser_version:'0.0.0.0',worker_id:'declared-failure'},new AbortController().signal);}
 catch(value){error=value;}
 expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('COMPUTER_WORKER_REPLY_UNKNOWN');
 expect(browserQualificationFailureDetails(error)).toEqual({schema:'dreamgraph.browser_qualification_failure_details.v1',completed_checks:[],worker_phase:'bootstrap'});
 expect(JSON.stringify((error as Error).cause)).not.toContain('SYNTHETIC_SECRET');
});
it('unrecognized or injected diagnostic data is absent from the output',()=>{
 expect(browserQualificationFailureDetails(new Error('failure',{cause:{phase:'SYNTHETIC_SECRET'}}))).toBeUndefined();
 expect(browserQualificationFailureDetails(new Error('failure',{cause:{schema:'dreamgraph.browser_qualification_failure_details.v1',
  completed_checks:['BW01'],worker_phase:'act',payload:'SYNTHETIC_SECRET'}}))).toBeUndefined();
 expect(browserQualificationFailureDetails(new Error('failure',{cause:{schema:'dreamgraph.browser_qualification_failure_details.v1',
  completed_checks:['SYNTHETIC_SECRET'],worker_phase:null}}))).toBeUndefined();
});
