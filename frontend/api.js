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
  let data;
  try { data = await response.json(); }
  catch { throw new ApiError('Сервер вернул неверный ответ. Проверьте, что запущен backend.server.', response.status); }
  if (response.status===401 && typeof window!=='undefined')window.dispatchEvent(new Event('session-expired'));
  if (!response.ok) throw new ApiError(data.error || 'Не удалось выполнить запрос.',response.status);
  return data;
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

export async function waitForJob(courseId,jobId,{isCurrent=()=>true,onConnectionChange=()=>{},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  while(isCurrent()){
    await delay(1000);
    if(!isCurrent())return null;
    let record;
    try {record=await request(`/courses/${courseId}`);}
    catch(error){
      if(!isCurrent())return null;
      if(error.status!==0 && error.status<500)throw error;
      onConnectionChange(error);continue;
    }
    if(!isCurrent())return null;
    onConnectionChange(null);
    if(record.job?.id!==jobId)throw new ApiError('Состояние запуска изменилось. Откройте сохранённую программу.',409);
    if(record.job.status!=='running')return record;
  }
  return null;
}
