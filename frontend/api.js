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
