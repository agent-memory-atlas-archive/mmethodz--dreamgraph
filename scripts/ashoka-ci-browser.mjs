/** CI-only readback of the explicitly installed pinned browser, never a daemon activation. */
import {chromium} from 'playwright-core';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile,realpath} from 'node:fs/promises';
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.GITHUB_ENV)throw new Error('ASHOKA_BROWSER_READBACK_REQUIRES_ACTIONS');
const executable=await realpath(chromium.executablePath());
if(/[\r\n]/.test(executable))throw new Error('ASHOKA_BROWSER_PATH_INVALID');
const {stdout}=await promisify(execFile)(executable,['--version'],{windowsHide:true,timeout:10000,maxBuffer:8192});
const version=stdout.trim().match(/(?:Chromium|Google Chrome(?: for Testing)?) ([0-9]+(?:\.[0-9]+){3})$/)?.[1];
if(!version)throw new Error('ASHOKA_BROWSER_VERSION_UNVERIFIED');
await appendFile(process.env.GITHUB_ENV,'ASHOKA_BROWSER_EXECUTABLE='+executable+'\nASHOKA_BROWSER_VERSION='+version+'\n');
console.log(JSON.stringify({browser_executable:executable,browser_version:version,model_requests:0,scope:'Version readback only; no browser session, grant or input.'}));
