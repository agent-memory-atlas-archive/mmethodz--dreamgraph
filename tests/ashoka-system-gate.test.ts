/** Offline gate acceptance must not turn aggregate green counts into missing-case/platform proof. */
import {expect,it} from 'vitest';
import {assertRootReport,assertEditorReport,assertBrowserProof,systemSteps} from '../scripts/run-ashoka-system-checks.mjs';
const root=()=>({success:true,numFailedTestSuites:0,numFailedTests:0,numTodoTests:0,numPassedTests:1,numTotalTests:1,numPendingTests:0,
 testResults:[{name:'one.test.ts',status:'passed',assertionResults:[{status:'passed',fullName:'Required original-owner fixture'}]}]});
it('requires every discovered root file and refuses an unreviewed skip despite green totals',()=>{
 expect(assertRootReport(root(),['one.test.ts']).passed).toBe(1);
 expect(()=>assertRootReport(root(),['one.test.ts','unrun.test.ts'])).toThrow('FILE_COVERAGE');
 const skipped=root();skipped.numPassedTests=0;skipped.numPendingTests=1;skipped.testResults[0].assertionResults[0].status='skipped';
 expect(()=>assertRootReport(skipped)).toThrow();
 const inflated=root();inflated.numPassedTests=999;expect(()=>assertRootReport(inflated)).toThrow('MISSING_OR_UNEXPECTED_SKIP');
});
it('names only the two retired particle assertions rather than permitting arbitrary pending coverage',()=>{
 const retired=root();retired.numTotalTests++;retired.numPendingTests=1;
 retired.testResults[0].assertionResults.push({status:'skipped',fullName:'ParticleSystem ParticleSystem removed in Slice F1'});
 expect(assertRootReport(retired).skip_names).toEqual(['ParticleSystem ParticleSystem removed in Slice F1']);
 retired.testResults[0].assertionResults[1].fullName='Unrun native desktop';expect(()=>assertRootReport(retired)).toThrow('UNEXPECTED_SKIP');
});
it('refuses compiled-editor cancellation, skips and missing summaries, including Node decorative output',()=>{
 const tap='# tests 546\n# pass 546\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
 expect(assertEditorReport(tap).passed).toBe(546);expect(assertEditorReport(tap.replaceAll('#','ℹ')).passed).toBe(546);
 for(const log of [tap.replace('cancelled 0','cancelled 1'),tap.replace('skipped 0','skipped 1'),tap.replace('tests 546','tests 547'),tap.replace('# todo 0\n','')])expect(()=>assertEditorReport(log)).toThrow('EDITOR_SUITE');
});
const browser=()=>({worker:{qualification:{evidence_scope:'actual_runtime',platform:'linux',architecture:'x64',scope_negative_passed:true,privacy_passed:true,bounded_actions_passed:true,
 stop_release_ms:250,control_loss_stop_ms:3000,cases:['CU04','CU05','CU10','CU20','CU24']}},evidence:{model_requests:0,traces:Array.from({length:11},(_,i)=>({id:i===3?'BW04':String(i),evidence:{termination_ms:1500}}))}});
it('actual browser coverage retains all subchecks and independent Stop bounds without admitting desktop/model claims',()=>{
 expect(assertBrowserProof(browser())).toMatchObject({platform:'linux',checks:11});
 for(const patch of [{evidence_scope:'declared_fixture'},{stop_release_ms:1001},{control_loss_stop_ms:5001},{privacy_passed:false},{cases:['CU05']}]){
  const value=browser();Object.assign(value.worker.qualification,patch);expect(()=>assertBrowserProof(value)).toThrow('BROWSER_NOT_QUALIFIED');
 }
 const missing=browser();missing.evidence.traces.pop();expect(()=>assertBrowserProof(missing)).toThrow();
 const late=browser();late.evidence.traces[3].evidence.termination_ms=5001;expect(()=>assertBrowserProof(late)).toThrow('BROWSER_NOT_QUALIFIED');
 expect(systemSteps.map(step=>step[0])).toContain('editor-tests');expect(systemSteps.map(step=>step[0])).toContain('root-tests');expect(systemSteps.at(-1)?.[0]).toBe('browser');
 expect(systemSteps.every(step=>!step[2].some(arg=>/migrate|canary|real_model|install.ps1|restart/.test(arg)))).toBe(true);
});
