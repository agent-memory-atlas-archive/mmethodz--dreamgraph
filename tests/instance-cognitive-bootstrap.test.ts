/** Fresh templates must be consumed by the actual engine/analytics, without repairing old instances. */
import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createInstance} from '../src/instance/lifecycle.js';
import {DATA_STUBS} from '../src/instance/types.js';
import {engine} from '../src/cognitive/engine.js';
import {getDataDir,setDataDirOverride} from '../src/utils/paths.js';
import {captureAnalyticsSnapshot} from '../src/observability/analytics-snapshot.js';
import {readCognitiveStore} from '../src/cognitive/cognitive-store.js';
import {releaseGraphWriter} from '../src/graph/writer-lease.js';
import {commitGraphWrites} from '../src/graph/publication.js';
const shapes:Record<string,string[]>={'dream_history.json':['sessions'],'tension_log.json':['signals','resolved_tensions'],'candidate_edges.json':['results'],'validated_edges.json':['edges']};
it('a real new instance has valid empty cognitive and analytics stores before its first scan or model call',async()=>{
 const previous=getDataDir(),root=await mkdtemp(join(tmpdir(),'dg-new-cognitive-'));
 let data:string|undefined;
 try{
  const instance=await createInstance({name:'qualified-bootstrap',projectRoot:root,masterDir:join(root,'master'),repos:{fixture:root}});data=instance.scope.dataDir;setDataDirOverride(data);
  for(const [file,arrays] of Object.entries(shapes)){const read=await readCognitiveStore(file,{metadata:{}},arrays) as any;for(const array of arrays)expect(read[array],file).toEqual([]);}
  expect((await engine.loadDreamHistory()).sessions).toEqual([]);expect((await engine.loadCandidateEdges()).results).toEqual([]);expect((await engine.loadValidatedEdges()).edges).toEqual([]);
  const analytics=JSON.parse((await captureAnalyticsSnapshot()).payload_json);expect(analytics.history).toEqual([]);expect(analytics.resolved_tensions).toEqual([]);expect(analytics.state.availability).toBe('available');
 }finally{if(data)await releaseGraphWriter(data);setDataDirOverride(previous);await rm(root,{recursive:true,force:true});}
});
it('emergency fallback stubs use the same consumed empty shapes rather than legacy containers',async()=>{
 const previous=getDataDir(),root=await mkdtemp(join(tmpdir(),'dg-fallback-cognitive-'));setDataDirOverride(root);
 try{await commitGraphWrites({actor:'fallback-fixture',scope:Object.keys(shapes),writes:Object.keys(shapes).map(file=>({file,content:JSON.stringify(DATA_STUBS[file])}))});
  for(const [file,arrays] of Object.entries(shapes)){const read=await readCognitiveStore(file,{metadata:{}},arrays) as any;for(const array of arrays)expect(read[array],file).toEqual([]);}
  expect(JSON.parse((await captureAnalyticsSnapshot()).payload_json).state.completeness).toBe('complete');
 }finally{await releaseGraphWriter(root);setDataDirOverride(previous);await rm(root,{recursive:true,force:true});}
});
