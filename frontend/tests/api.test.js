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
