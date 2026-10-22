export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export async function request(path, {method = 'GET', body} = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, headers: body === undefined ? {} : {'Content-Type':'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch { throw new ApiError('Нет связи с локальным сервером. Правки остаются в этой вкладке.'); }
  if (response.status===401 && typeof window!=='undefined')window.dispatchEvent(new Event('session-expired'));
  const invalidResponse=()=>new ApiError(response.status===401
    ? 'Сессия истекла. Войдите с паролем команды.'
    : 'Сервер временно недоступен или вернул неверный ответ. Повторите проверку состояния.',response.ok?502:response.status);
  let data;
  try { data = await response.json(); }
  catch { throw invalidResponse(); }
  if(!data||typeof data!=='object'||Array.isArray(data))throw invalidResponse();
  if (!response.ok) throw new ApiError(typeof data.error==='string'?data.error:'Не удалось выполнить запрос.',response.status);
  return data;
}

// An uncertain POST is repeated only by an explicit action, with the original ID.
export function createGenerationSubmission() {
  const pending=new Map();
  return {
    has(courseId){return pending.has(courseId);},
    clear(courseId){pending.delete(courseId);},
    async run(courseId,body){
      if(!pending.has(courseId))pending.set(courseId,structuredClone(body));
      const submission=pending.get(courseId);
      try {
        const job=await request(`/courses/${courseId}/generate`,{method:'POST',body:submission});
        if(typeof job.id!=='string'||!['running','completed','failed'].includes(job.status))throw new ApiError('Не получено подтверждение запуска. Повторите проверку того же запроса.',502);
        pending.delete(courseId);return job;
      } catch(error) {
        if(error.status>=400&&error.status<500)pending.delete(courseId);
        throw error;
      }
    },
  };
}

// Each row owns a version: any URL edit invalidates both successes and failures.
export function createSourceCheck() {
  let version=0;
  return {
    invalidate(){version++;},
    async run(url){
      const token=++version;
      try {
        const result=await request('/sources/check',{method:'POST',body:{url}});
        return token===version ? result : null;
      } catch(error) {if(token===version)throw error;return null;}
    },
  };
}

export function createGenerationGuard() {
  let active=false;
  return {
    get active(){return active;},
    async run(action){
      if(active)return null;
      active=true;
      try{return await action();}finally{active=false;}
    },
  };
}

export async function waitForJob(courseId,jobId,{isCurrent=()=>true,onConnectionChange=()=>{},maxConnectionErrors=5,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  let failures=0;
  while(isCurrent()){
    await delay(Math.min(1000*2**failures,15000));
    if(!isCurrent())return null;
    let record;
    try {record=await request(`/courses/${courseId}`);}
    catch(error){
      if(!isCurrent())return null;
      if(error.status!==0 && error.status<500)throw error;
      onConnectionChange(error);
      if(++failures>=maxConnectionErrors)throw new ApiError('Связь с сервером не восстановлена. Запуск на сервере может продолжаться; проверьте его состояние, когда появится связь.',error.status);
      continue;
    }
    if(!isCurrent())return null;
    onConnectionChange(null);
    failures=0;
    if(record.job?.id!==jobId)throw new ApiError('Состояние запуска изменилось. Откройте сохранённую программу.',409);
    if(record.job.status!=='running')return record;
  }
  return null;
}
