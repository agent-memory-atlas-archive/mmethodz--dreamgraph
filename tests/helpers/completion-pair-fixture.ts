import type {CompletionPairSpecification} from '../../src/evaluation/agent-usefulness.js';
/** Declared offline contexts, model replies and tariffs; never provider price/model quality evidence. */
export const completionPairFixture=():CompletionPairSpecification=>({schema:'dreamgraph.completion_pair_specification.v1',scope:'read_only_supplied_context_completion',local_results:'private_job_artifact',
 task:{id:'frozen:architecture',project:'fixture',prompt:'Explain the supplied architecture and uncertainty.',required_outcomes:['correct_boundary'],mandatory_evidence_ids:['source:one'],forbidden_assertions:['invented source read']},
 execution:{provider:'openai',model:'gpt-4.1',api:'responses',effort:null,prompt_version:'fixture.v1',source_manifest_hash:'frozen:fixture',
  input_tokens:10000,output_tokens:100,context_bytes:1024,output_bytes:2048,max_calls:1,max_elapsed_ms:5000,retention:'store_false',currency:'USD',max_amount:1},
 arms:[{arm:'graph_assisted',context:'graph',source_manifest_hash:'frozen:fixture',context_bytes:5,construction_ms:1},{arm:'source_only',context:'source',source_manifest_hash:'frozen:fixture',context_bytes:6,construction_ms:2}],order:'source_first',
 endpoint:'https://api.openai.com/v1',api_key_env:'TEST_EVALUATION_SECRET',
 pricing:{version:'evaluation-fixture-v1',provider:'openai',model:'gpt-4.1',currency:'USD',source:'declared offline tariff, not provider pricing',input_per_million:1,output_per_million:1,output_includes_reasoning:true,input_includes_images:true},
 budget:{requests:2,input_tokens:20000,output_tokens:200,reasoning_tokens:200,retries:0,elapsed_ms:10000,concurrency:1,max_hops:0,max_neighbors:0,run_amount:1,day_amount:1,currency:'USD',pricing_version:'evaluation-fixture-v1',billing_principal:'fixture-evaluation-account'}});
