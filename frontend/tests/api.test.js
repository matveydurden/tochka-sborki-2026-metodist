import test from 'node:test';
import assert from 'node:assert/strict';
import {request,ApiError} from '../api.js';
test('конфликт сохранения передаёт статус и сообщение сервера', async () => {
  const original = global.fetch;
  try {
    global.fetch=async()=>new Response(JSON.stringify({error:'Версия изменилась'}),{status:409});
    await assert.rejects(()=>request('/courses/id',{method:'PUT',body:{revision:0}}), error=>error instanceof ApiError&&error.status===409&&error.message==='Версия изменилась');
  } finally {global.fetch=original;}
});
test('сетевой сбой не выдаётся за успешное сохранение', async () => {
  const original = global.fetch;
  try {
    global.fetch=async()=>{throw new TypeError('offline');};
    await assert.rejects(()=>request('/courses'),/Нет связи/);
  } finally {global.fetch=original;}
});

test('изменение ссылки туда и обратно отбрасывает ответ старой проверки',async()=>{
  const {createSourceCheck}=await import('../api.js');
  const original=global.fetch;let finish;
  try {
    global.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const check=createSourceCheck();
    const pending=check.run('https://example.org/a');
    check.invalidate(); // A -> B
    check.invalidate(); // B -> A
    finish(new Response(JSON.stringify({status:'accessible'}),{status:200}));
    assert.equal(await pending,null);
    global.fetch=async()=>new Response(JSON.stringify({status:'redirect'}),{status:200});
    assert.deepEqual(await check.run('https://example.org/a'),{status:'redirect'});
  } finally {global.fetch=original;}
});

test('ошибка устаревшей проверки не затирает состояние изменённой ссылки',async()=>{
  const {createSourceCheck}=await import('../api.js');
  const original=global.fetch;let fail;
  try {
    global.fetch=()=>new Promise((_,reject)=>{fail=reject;});
    const check=createSourceCheck();const pending=check.run('https://example.org/a');check.invalidate();
    fail(new TypeError('offline'));
    assert.equal(await pending,null);
  } finally {global.fetch=original;}
});

test('наблюдение восстанавливается после сетевого сбоя без повторной генерации',async()=>{
  const {waitForJob}=await import('../api.js');const original=global.fetch;const calls=[];let attempt=0;const changes=[];
  try {
    global.fetch=async(url,options)=>{calls.push([url,options.method]);attempt++;if(attempt===1)throw new TypeError('offline');return new Response(JSON.stringify({revision:2,job:{id:'job-1',status:attempt===2?'running':'completed'}}),{status:200});};
    const record=await waitForJob('course-1','job-1',{delay:async()=>{},isCurrent:()=>true,onConnectionChange:error=>changes.push(Boolean(error))});
    assert.equal(record.job.status,'completed');assert.equal(calls.length,3);
    assert.ok(calls.every(([url,method])=>url==='/api/courses/course-1'&&method==='GET'));
    assert.deepEqual(changes,[true,false,false]);
  } finally {global.fetch=original;}
});

test('смена программы прекращает наблюдение и не отдаёт запоздалый результат',async()=>{
  const {waitForJob}=await import('../api.js');const original=global.fetch;let current=true;
  try {
    global.fetch=async()=>{current=false;return new Response(JSON.stringify({job:{id:'job-1',status:'completed'}}),{status:200});};
    assert.equal(await waitForJob('course-1','job-1',{delay:async()=>{},isCurrent:()=>current}),null);
  } finally {global.fetch=original;}
});

test('защита запуска блокирует второй запрос до завершения первого сохранения',async()=>{
  const {createGenerationGuard}=await import('../api.js');const guard=createGenerationGuard();let finish;let calls=0;
  const first=guard.run(async()=>{calls++;await new Promise(resolve=>{finish=resolve;});return 'started';});
  assert.equal(guard.active,true);assert.equal(await guard.run(async()=>{calls++;}),null);
  finish();assert.equal(await first,'started');assert.equal(calls,1);assert.equal(guard.active,false);
  await assert.rejects(()=>guard.run(async()=>{throw new Error('save failed');}),/save failed/);
  assert.equal(guard.active,false);
});

test('ERR-03: повтор после потерянного ответа использует тот же requestId и исходные параметры',async()=>{
  const {createGenerationSubmission}=await import('../api.js');
  assert.equal(typeof createGenerationSubmission,'function');
  const original=global.fetch;const sent=[];let calls=0;
  try {
    global.fetch=async(url,options)=>{
      sent.push(JSON.parse(options.body));
      if(++calls===1)throw new TypeError('response lost');
      return new Response(JSON.stringify({id:'original-job',status:'completed'}));
    };
    const submit=createGenerationSubmission();
    const body={revision:1,stage:'skeleton',prompt:'Исходный запрос',requestId:'original-id'};
    await assert.rejects(()=>submit.run('course-1',body),ApiError);
    assert.equal(submit.has('course-1'),true);
    body.prompt='Поздняя правка';
    const result=await submit.run('course-1',{...body,requestId:'new-id'});
    assert.equal(result.id,'original-job');
    assert.deepEqual(sent[0],sent[1]);
    assert.equal(sent[1].prompt,'Исходный запрос');
    assert.equal(submit.has('course-1'),false);
  } finally {global.fetch=original;}
});

test('ERR-04: HTML 401 завершает сессию и не показывает служебный ответ',async()=>{
  const original=global.fetch,originalWindow=global.window;const events=new EventTarget();let expired=0;
  events.addEventListener('session-expired',()=>expired++);global.window=events;
  try {
    global.fetch=async()=>new Response('<html>private gateway details</html>',{status:401});
    await assert.rejects(()=>request('/courses'),error=>error.status===401&&!error.message.includes('private'));
    assert.equal(expired,1);
  } finally {global.fetch=original;if(originalWindow===undefined)delete global.window;else global.window=originalWindow;}
});

test('ERR-04: непригодный JSON и HTML 502 обрабатываются как временный отказ',async()=>{
  const original=global.fetch;
  try {
    for(const body of ['null','[]','"unexpected"','<html>private gateway details</html>']){
      global.fetch=async()=>new Response(body,{status:body.startsWith('<')?502:200});
      await assert.rejects(()=>request('/courses'),error=>error instanceof ApiError&&error.status===502&&!error.message.includes('private'));
    }
  } finally {global.fetch=original;}
});

test('ERR-05: длительный обрыв останавливает опрос с возможностью продолжить тот же job',async()=>{
  const {waitForJob}=await import('../api.js');const original=global.fetch;const calls=[],delays=[];
  try {
    global.fetch=async(url,options)=>{
      calls.push([url,options.method]);
      if(calls.length<=3)throw new TypeError('offline');
      return new Response(JSON.stringify({job:{id:'job-1',status:'completed'}}));
    };
    await assert.rejects(()=>waitForJob('course-1','job-1',{maxConnectionErrors:3,delay:async ms=>delays.push(ms)}),/связ|Связ/);
    assert.equal(calls.length,3);
    assert.deepEqual(delays,[1000,2000,4000]);
    const result=await waitForJob('course-1','job-1',{delay:async()=>{}});
    assert.equal(result.job.status,'completed');
    assert.ok(calls.every(([url,method])=>url==='/api/courses/course-1'&&method==='GET'));
  } finally {global.fetch=original;}
});
