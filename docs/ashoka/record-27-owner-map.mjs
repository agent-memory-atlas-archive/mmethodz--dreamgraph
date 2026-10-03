/** Map exact passed component cases to every frozen owner/compound obligation, without inferring whole-case acceptance. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const baselinePath='tests/fixtures/ashoka/baseline.json',simulationPath='docs/audits/2026-09-30-coverage/execution-simulation.json';
const baseline=await read(baselinePath),simulation=await read(simulationPath),gateDirectory='docs/ashoka/slice-27-offline-gate-sixth';
const gate=await read(gateDirectory+'/result.json'),root=await read(gateDirectory+'/root-tests.json'),source=await read(gateDirectory+'/source-inventory.json');
assert.equal(gate.status,'passed');assert.equal(gate.source_hash,source.hash);assert.equal(root.numFailedTests,0);assert.equal(baseline.owners.length,29);
for(const file of source.files.filter(file=>file.path.startsWith('tests/')&&file.path.endsWith('.test.ts')))assert.equal(sha(await readFile(file.path)),file.sha256,file.path);
const owners=[
 ['Instance and transport authority',['http-session-isolation.test.ts','daemon-transport-isolation.test.ts','session-authority.test.ts']],
 ['Canonical graph and persistence',['graph-publication.test.ts','graph-read-model.test.ts']],
 ['Repository and language scanners',['tools/scan-project-incremental-e2e.test.ts','tools/native-ui-scanner.test.ts']],
 ['Coverage and scan ledger',['tools/coverage-ledger.test.ts','tools/scan-project-incremental-e2e.test.ts']],
 ['Enrichment and recovery',['tools/enrichment-publication.test.ts','tools/enrich-parser-nodes.test.ts']],
 ['Provider routing and model readiness',['role-provider.test.ts','model-execution.test.ts','model-admission.test.ts']],
 ['Core cognitive state machine',['engine-jobs.test.ts','instance-cognitive-bootstrap.test.ts','dirty-digestion.test.ts']],
 ['Dream strategy portfolio',['strategy-registry.test.ts','strategy-portfolio.test.ts','cognitive-attribution-integration.test.ts']],
 ['Truth filter and promotion',['normalization-evidence.test.ts','cognitive-policy-evaluation.test.ts']],
 ['Trust and evidence projections',['context-pack.test.ts','resource-query.test.ts','explorer-canonical-navigation.test.ts']],
 ['Calibration and metacognition',['cognitive-policy-evaluation.test.ts','analytics-observability.test.ts']],
 ['Decay and graph maintenance',['curation-retention.test.ts','dirty-digestion.test.ts']],
 ['Tension detection and clustering',['risk-remediation.test.ts','temporal-federation.test.ts']],
 ['Remediation and adaptive futures',['risk-remediation.test.ts','plan-context-integration.test.ts']],
 ['Temporal and causal reasoning',['temporal-federation.test.ts']],
 ['Scheduling and cognitive events',['scheduler-authority.test.ts','event-job-intake.test.ts','schedule-http.test.ts']],
 ['Targeted dreams and bootstrap',['instance-cognitive-bootstrap.test.ts','strategy-registry.test.ts']],
 ['Federation',['temporal-federation.test.ts']],
 ['Lucid interaction',['lifecycle-narrative.test.ts']],
 ['Narrative, story and playback',['lifecycle-narrative.test.ts','analytics-observability.test.ts']],
 ['Agent retrieval and preamble',['client-context-integration.test.ts','execution-context.test.ts','computer-native-graph-loop.test.ts']],
 ['MCP tools and resources',['mcp-catalog-boundary.test.ts','mcp-bridge-transport.test.ts','resource-query.test.ts']],
 ['CLI and client adapters',['architect-cli-bridge.test.ts','host-managed-execution.test.ts','client-context-integration.test.ts']],
 ['Architect planning and governance',['plan-authority.test.ts','plan-workflow.test.ts','plan-context-integration.test.ts']],
 ['Dashboard and configuration',['configuration-http.test.ts','configuration-workspace.test.ts','schedule-http.test.ts']],
 ['2D/3D Explorer',['explorer-canonical-navigation.test.ts']],
 ['Analytics and observability',['analytics-observability.test.ts','webhooks/worker.test.ts']],
 ['Plugins and host/SDK packages',['plugins/contributions-boundary.test.ts','plugins/graph-context-port.test.ts','host-managed-execution.test.ts']],
 ['Docs, release and install',['workspace-installation.test.ts','cli-start-health.test.ts','ashoka-system-gate.test.ts']],
];
assert.deepEqual(owners.map(row=>row[0]),baseline.owners.map(owner=>owner.family),'Frozen owner identity/order changed.');
const evidence=files=>files.map(file=>{
 const path='tests/'+file,item=source.files.find(item=>item.path===path),suite=root.testResults.find(result=>result.name.replaceAll('\\','/').endsWith('/'+path));
 assert(item&&suite,path);assert(suite.assertionResults.every(test=>test.status==='passed'),path);
 return {source:path,sha256:item.sha256,report:gateDirectory+'/root-tests.json',cases:suite.assertionResults.map(test=>({name:test.fullName,status:test.status})),
  interpretation:'These exact component cases passed under their declared boundaries. A file association alone does not prove the whole frozen integration obligation.'};
});
const compoundFiles=[
 ['client-context-integration.test.ts','computer-native-graph-loop.test.ts'],['graph-publication.test.ts','curation-retention.test.ts'],
 ['graph-publication.test.ts','change-obligations.test.ts'],['engine-jobs.test.ts','scheduler-authority.test.ts'],
 ['model-admission.test.ts','event-job-intake.test.ts'],['configuration-http.test.ts','engine-configuration.test.ts'],
 ['http-session-isolation.test.ts','plan-context-integration.test.ts'],['plan-authority.test.ts','plan-workflow.test.ts'],
 ['change-obligations.test.ts','dirty-digestion.test.ts','computer-peer-crash.test.ts'],['host-managed-execution.test.ts','plugins/contributions-boundary.test.ts'],
 ['dirty-digestion.test.ts','event-job-intake.test.ts'],['schedule-workspace.test.ts','scheduler-authority.test.ts'],
 ['resource-query.test.ts','retrieval-index.test.ts'],['role-provider.test.ts','normalization-evidence.test.ts'],
 ['temporal-federation.test.ts','lifecycle-narrative.test.ts'],['analytics-observability.test.ts','explorer-canonical-navigation.test.ts'],
 ['computer-peer-crash.test.ts','computer-capabilities.test.ts'],['legacy-graph-upgrade.test.ts','graph-upgrade-notice.test.ts'],
 ['workspace-installation.test.ts','legacy-graph-upgrade.test.ts'],['computer-native-graph-loop.test.ts','computer-broker.test.ts'],
 ['analytics-observability.test.ts','graph-read-model.test.ts','tools/graph-health.test.ts']
];
assert.equal(compoundFiles.length,simulation.compound_case_ids.length);
const text=await readFile('docs/audits/2026-09-30-coverage/execution-simulation.md','utf8');
const definitions=new Map([...text.matchAll(/^\| (XS\d{2}) \| (.+?) \| (.+?) \|\r?$/gm)].map(match=>[match[1],{trigger:match[2],required_outcome:match[3]}]));
const xs21=text.match(/### XS21[^\r\n]*\r?\n\r?\n([^\r\n]+)/);assert(xs21);definitions.set('XS21',{trigger:'One initial scan, continuously maintained graph',required_outcome:xs21[1]});
for(const id of simulation.compound_case_ids)assert(definitions.has(id),id);
const report={schema:'dreamgraph.ashoka.requirement_evidence_map.v1',recorded_at:new Date().toISOString(),
 status:'component_mapping_composed_acceptance_pending',source_hash:source.hash,baseline:{revision:18,sha256:sha(await readFile(baselinePath)),contracts:42},
 simulation:{plan_revision:7,sha256:sha(await readFile(simulationPath))},gate:{report:gateDirectory+'/result.json',root:gate.root,editor:gate.editor,browser:gate.browser},
 owners:owners.map(([family,files],index)=>({...baseline.owners[index],family,component_evidence:evidence(files),
  integration_status:'component_cases_passed_compound_review_pending',remaining:'Review/execute the exact frozen producer-consumer obligation and compound joins; do not infer whole-family acceptance from associated green files.'})),
 compound:simulation.compound_case_ids.map((id,index)=>({id,...definitions.get(id),definition:'docs/audits/2026-09-30-coverage/execution-simulation.md',
  component_evidence:evidence(compoundFiles[index]),status:'partial_component_evidence',remaining:'Bind a composed execution/fault/recovery trace and reviewer disposition to all conditions of this exact scenario.'})),
 required_unverified:['Whole GE16 and actual paired understanding on both established projects; read-only answer collection is only an unscored component.',
  'All CU/XS platform/native-CLI/provider routes and physical editor support advertised at release, with explicit honest deferrals where allowed.',
  'Reviewed own-instance U0–U8 cutover and final synchronized14.0.0 packaged install/activation/rollback.',
  'Complete contract/risk/client/graph-class and all PL/GE/UX/SC/AT acceptance joins; this owner/XS map is an explicit first component.'],
 acceptance_claim:false,real_provider_requests:0,remote_ci_jobs_run:0,windows_global_changed:false};
await writeFile('docs/ashoka/slice-27-owner-evidence-map.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,owners:report.owners.length,compound:report.compound.length,acceptance_claim:false}));
