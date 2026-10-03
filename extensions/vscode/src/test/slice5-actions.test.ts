import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';

test('Slice 5 source includes show_full storage and action state messaging', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /fullContent\?: string/);
  assert.match(source, /type: 'messageActionState'/);
  assert.match(source, /status: 'loading' \| 'completed' \| 'failed'/);
});

test('operator actions without daemon authority refuse rather than falling back to a local file write', async () => {
  const {ChatPanel}=require(join(process.cwd(),'../../tests/helpers/compiled-editor.cjs')).compiledEditor();
  const root=await mkdtemp(join(tmpdir(),'dg-editor-action-refusal-')),file=join(root,'source.ts'),panel=new ChatPanel({});
  try{
    await writeFile(file,'original source 🌿');
    await assert.rejects(()=>panel._executeMessageActionTool('write_file',{filePath:file,content:'must not bypass authority'}),/OPERATOR_AUTHORITY_CHANGED/);
    assert.equal(await readFile(file,'utf8'),'original source 🌿');
    assert.equal(panel._lastToolTrace.at(-1).status,'failed');
  }finally{panel.dispose();await rm(root,{recursive:true,force:true});}
});

test('Slice 5 source logs action provenance with outcome and detail', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'chat-panel.ts'), 'utf8');
  assert.match(source, /detail\?: string/);
  assert.match(source, /sourceMessageId: messageId/);
  assert.match(source, /outcome: 'completed'/);
  assert.match(source, /outcome: 'failed'/);
  assert.match(source, /outcome: 'cancelled'/);
});
