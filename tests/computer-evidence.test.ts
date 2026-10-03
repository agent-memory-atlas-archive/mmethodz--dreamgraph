/** Descriptor/byte verification only. These literal pixels do not qualify any physical worker. */
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyComputerEvidence} from '../packages/sdk/src/seams/computer-control.js';
const literal=Buffer.from('declared image bytes'),digest='sha256:'+createHash('sha256').update(literal).digest('hex');
function fixture(){const now=new Date().toISOString(),expires=new Date(Date.now()+20000).toISOString(),observation={schema:'dreamgraph.computer_observation.v1',id:'dom',target_id:'target',target_generation:1,execution_id:'execution',
 kind:'dom',observed_at:now,expires_at:expires,artifact_ref:null,content_hash:digest,evidence_ids:[],verified:false};
 return {ok:true,schema:'dreamgraph.computer_evidence.v1',instance_id:'instance',execution_id:'execution',computer_session_id:'computer',fence:1,worker_available:true,
  observation:{observation,summary:'Literal untrusted evidence',expired:false,image_observation:{...observation,id:'pixels',kind:'pixels',evidence_ids:['dom']},image:{mime_type:'image/png',content_hash:digest,data_base64:literal.toString('base64')}}};}
it('validates an ephemeral image against its original linked C17 descriptors and actual SHA256 bytes',async()=>{
 const result=await verifyComputerEvidence(fixture());expect(result.observation?.image?.content_hash).toBe(digest);expect(result).not.toHaveProperty('ok');
});
it('refuses corrupted bytes, unlinked pixels, wrong execution and noncanonical base64',async()=>{
 const bytes=fixture();bytes.observation.image.data_base64=Buffer.from('changed image bytes').toString('base64');await expect(verifyComputerEvidence(bytes)).rejects.toThrow('HASH_MISMATCH');
 const link=fixture();link.observation.image_observation.evidence_ids=['other'];await expect(verifyComputerEvidence(link)).rejects.toThrow('DESCRIPTOR_MISMATCH');
 const owner=fixture();owner.observation.observation.execution_id='foreign';await expect(verifyComputerEvidence(owner)).rejects.toThrow('DESCRIPTOR_MISMATCH');
 const bad=fixture();bad.observation.image.data_base64='aGVsbG9=';await expect(verifyComputerEvidence(bad)).rejects.toThrow('BYTE_BOUND');
});
it('pixels that expire during transport are cleared while historical descriptors remain explicitly expired',async()=>{
 const value=fixture();value.observation.observation.expires_at=value.observation.image_observation.expires_at=new Date(Date.now()-1).toISOString();
 const result=await verifyComputerEvidence(value);expect(result.observation?.expired).toBe(true);expect(result.observation?.image).toBeUndefined();expect(result.observation?.image_observation?.id).toBe('pixels');
 const inconsistent=fixture();inconsistent.observation.expired=true;await expect(verifyComputerEvidence(inconsistent)).rejects.toThrow('IMAGE_DESCRIPTOR_MISMATCH');
});
