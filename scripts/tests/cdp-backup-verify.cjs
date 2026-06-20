// CDP 真机验证: backup-restore 页不崩 + 立刻备份不 ReferenceError
const http = require('http');
const WebSocket = require('ws');
const PORT = 9223;
function getJson(p){return new Promise((r,j)=>{http.get(`http://localhost:${PORT}${p}`,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{r(JSON.parse(d))}catch(e){j(e)}})}).on('error',j)})}
async function main(){
  const targets = await getJson('/json');
  const page = targets.find(t=>t.type==='page')||targets[0];
  if(!page){console.error('FAIL: no page target');process.exit(1)}
  console.log('CDP target:', page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result)}});
  const send=(method,params={})=>new Promise((r,j)=>{const i=++id;pending.set(i,{resolve:r,reject:j});ws.send(JSON.stringify({id:i,method,params}))});
  const ev=fn=>send('Runtime.evaluate',{expression:`(()=>{${fn}})()`,awaitPromise:true,returnByValue:true}).then(r=>r.exceptionDetails?(()=>{throw new Error(JSON.stringify(r.exceptionDetails))})():r.result.value);
  await new Promise(r=>ws.on('open',r));

  // 1. 导航到 backup-restore (testid = sidebar-item-backup-restore)
  await ev(`document.querySelector('[data-testid="sidebar-item-backup-restore"]').click();`);
  await new Promise(r=>setTimeout(r,1200));
  const pageMounted = await ev(`return !!document.querySelector('[data-testid="backup-restore-page"]');`);
  console.log('1. backup-restore page mounted:', pageMounted);

  // 2. 挂全局错误监听 (catch ReferenceError)
  await ev(`window.__cdpErrors=[];window.addEventListener('error',function(e){window.__cdpErrors.push(e.message)});return true;`);

  // 3. 点 [立刻备份] —— 之前 process.platform ReferenceError 崩在这条路径
  const btnExists = await ev(`return !!document.querySelector('[data-testid="backup-now-btn"]');`);
  console.log('2. backup-now-btn present:', btnExists);
  await ev(`document.querySelector('[data-testid="backup-now-btn"]').click();`);
  await new Promise(r=>setTimeout(r,3500));

  // 4. 收集结果
  const errors = await ev(`return window.__cdpErrors;`);
  const message = await ev(`const el=document.querySelector('[data-testid="backup-message"]');return el?el.getAttribute('data-message-kind')+' | '+el.textContent:null;`);
  const count = await ev(`const el=document.querySelector('[data-testid="backup-count"]');return el?el.textContent:null;`);
  const pageStillMounted = await ev(`return !!document.querySelector('[data-testid="backup-restore-page"]');`);

  console.log('--- CDP RESULTS ---');
  console.log('uncaught errors:', JSON.stringify(errors));
  console.log('backup message:', message);
  console.log('backup count:', count);
  console.log('page still mounted after click:', pageStillMounted);

  const errStr = JSON.stringify(errors);
  const hasRefError = errStr.includes('ReferenceError')||errStr.includes('process is not defined');
  console.log('RESULT: ReferenceError present?', hasRefError);
  console.log('RESULT: no crash (page stable)?', pageStillMounted && !hasRefError);

  ws.close();
  process.exit((pageMounted && pageStillMounted && !hasRefError)?0:1);
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(2)});
