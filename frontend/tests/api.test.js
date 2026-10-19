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
