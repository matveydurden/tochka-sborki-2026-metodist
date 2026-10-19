import { createCourse, validate, updateCourse } from './model.js';
import { request } from './api.js';

// Icons use the Lucide outline vocabulary (ISC license, see assets/LUCIDE-LICENSE.txt).
const paths = {
  plus:'M12 5v14M5 12h14', minus:'M5 12h14', eye:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  download:'M21 15v5H3v-5M12 3v12m-5-5 5 5 5-5', file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5',
  'check-square':'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  clipboard:'M9 3H5v18h14V3h-4M9 2h6v4H9ZM8 11h8M8 15h6', monitor:'M2 3h20v14H2ZM8 21h8M12 17v4',
  expand:'M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7', collapse:'M21 9h-6V3M15 9l6-6M3 15h6v6M9 15l-6 6',
  edit:'M16 3a2 2 0 0 1 4 4L8 19l-5 2 2-5ZM14 5l4 4', folder:'M3 7V4h6l2 3h10v13H3Z',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z',
  check:'M20 6 9 17l-5-5', shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6ZM8 12l3 3 5-6',
  chevron:'m6 9 6 6 6-6', 'arrow-right':'M5 12h14m-5-5 5 5-5 5', 'arrow-up':'M12 19V5m-6 6 6-6 6 6',
  paperclip:'m21 11-9 9a6 6 0 0 1-8-8L15 1a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3L17 5',
  close:'M6 6l12 12M6 18 18 6', clock:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
  warning:'M12 3 1 21h22ZM12 9v4M12 17h.01', layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const decorate = (root = document) => root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); });
let course = createCourse();
let tab = 'program';
let view = 'preview';
let zoom = 100;
let busy = false;
let dirty = false;
let sessionChanged = false;
let proposal = null;
let attachments = [];
let messages = [];
let recordId = null;
let savedVersion = 0;
let saveQueue = Promise.resolve();
let pendingSaves = 0;
let saveError = null;
let initialized = false;
let generationToken = 0;
const names = { program:'Программа', tests:'Тесты с ключами', tasks:'Практические задания', slides:'Слайды лекции' };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function markSession() { sessionChanged = true; queueSave(); }
function shell() {
  $('#project-title').textContent = course.title;
  $('#draft-label').textContent = course.approved ? 'Каркас согласован' : 'Черновик';
  $('#file-name').textContent = names[tab];
  $('.file-type').textContent = course.isDemo ? 'ДЕМО' : 'ЧЕРНОВИК';
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === tab);
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  $('#zoom-label').textContent = `${zoom}%`;
  $('#document-canvas').style.setProperty('--zoom', zoom / 100);
  $('#document-status').textContent = view === 'editor' ? 'Ручные правки проверяются после сохранения' : 'Черновик для проверки методистом';
}
function renderParameters() {
  for (const field of $('#parameters-form').elements) if (field.name) field.value = course[field.name];
  renderChecks();
}
function renderChecks() {
  const result = validate(course);
  const ok = result.hours.valid && result.structure.valid;
  $('#validation-summary').innerHTML = `<div class="check-summary ${ok ? '' : 'warning'}"><span>${icon(ok ? 'check' : 'warning')}${ok ? 'Каркас проверен' : 'Нужна правка каркаса'}</span><span>${icon(result.hours.valid ? 'check' : 'clock')}${result.hours.total} / ${course.hours} ч</span></div>`;
  $('#check-count').textContent = `${Number(!result.hours.valid) + Number(!result.structure.valid) + Number(Boolean(course.materialsStale)) + 1} замеч.`;
  $('#checks-list').innerHTML = [
    [result.hours.valid, 'Сумма часов', result.hours.valid ? 'Часы модулей совпадают с общим объёмом.' : 'Скорректируйте объём или часы модулей в редакторе.'],
    [result.structure.valid, 'Полнота каркаса', result.structure.valid ? 'Название, цель и модули заполнены.' : 'Заполните название, цель и добавьте модули.'],
    [!course.materialsStale, 'Связанные материалы', course.materialsStale ? 'Каркас изменён. Материалы сохранены, но требуют обновления.' : 'Структурных изменений после подготовки не обнаружено.'],
    [false, 'Источники и содержание', 'Источники и предметное содержание требуют проверки экспертом.'],
  ].map(([valid, title, description]) => `<div class="check-item ${valid ? '' : 'warning'}">${icon(valid ? 'check' : 'warning')}<div><strong>${title}</strong><p>${description}</p></div></div>`).join('');
  $('#approve-button').disabled = !ok || course.approved;
  $('#approve-button').innerHTML = course.approved ? `${icon('check')}Согласовано` : `Согласовать каркас${icon('arrow-right')}`;
  $('#approval-status').textContent = course.approved ? 'Подтверждено методистом' : 'Решение принимает методист';
  $('.approval-row').classList.toggle('approved', course.approved);
  updateControls();
}
function paperFrame(content, label = 'Программа обучения') {
  return `<article class="paper"><div class="paper-top"><span>МЕТОДИСТ / ${label.toUpperCase()}</span><span>${course.isDemo ? 'ДЕМОНСТРАЦИОННЫЙ ПРИМЕР' : 'ЧЕРНОВИК ДЛЯ ПРОВЕРКИ'}</span></div>${content}<div class="paper-footer"><strong>Итого: ${course.hours} ч</strong><span>Черновик · ${label}</span></div></article>`;
}
function renderDocument() {
  shell();
  const canvas = $('#document-canvas');
  canvas.scrollTop = 0;
  if (view === 'editor') { renderEditor(); return; }
  const materialItems = tab === 'tests' ? course.tests : tab === 'tasks' ? course.tasks : course.slides;
  const legacy = tab === 'tests' ? course.question : tab === 'tasks' ? course.task : course.slide?.title;
  if (tab !== 'program' && !materialItems?.length && !legacy) {
    canvas.innerHTML = `<div class="empty-state">${icon('file')}<h3>Материал ещё не создан</h3><p>Согласуйте каркас и нажмите «Подготовить материалы» или добавьте содержание вручную.</p><button class="button primary" data-action="editor">Открыть редактор</button></div>`; return;
  }
  if (tab === 'program') {
    canvas.innerHTML = paperFrame(`<span class="section-number">ДОПОЛНИТЕЛЬНОЕ ОБРАЗОВАНИЕ</span><h2>${esc(course.title)}</h2><div class="paper-subtitle">${esc(course.type)} · ${course.hours} ч</div><h3>Цель программы</h3><p>${esc(course.goal || 'Цель пока не задана. Сформируйте каркас или добавьте её в редакторе.')}</p><h3>Аудитория</h3><p>${esc(course.audience || 'Аудитория пока не задана')}. Входной уровень — ${esc(course.level)}.</p><h3>Результаты обучения</h3>${(course.competencies || []).map(value=>`<p>• ${esc(value)}</p>`).join('') || '<p>Ещё не определены</p>'}<h3>Структура курса</h3>${course.modules.length ? `<ol>${course.modules.map(module => `<li><span>${esc(module.title)}</span><b>${module.hours} ч</b></li>`).join('')}</ol>` : '<p>Каркас ещё не сформирован.</p>'}${course.modules.filter(m=>m.content).map(module=>`<h3>${esc(module.title)}</h3><p class="preserve-lines">${esc(module.content)}</p>`).join('')}<h3>Итоговая аттестация</h3><p>${esc(course.assessment)}</p>`);
  } else if (tab === 'tests') {
    const entries = course.tests?.length ? course.tests : [{question:course.question,answer:course.answer,moduleIndex:0}];
    canvas.innerHTML = paperFrame(`<span class="section-number">ОЦЕНОЧНЫЕ МАТЕРИАЛЫ</span><h2>Тестовые вопросы</h2><div class="paper-subtitle">${esc(course.title)}</div>${entries.map((item,i)=>`<h3>${i+1}. ${esc(course.modules[item.moduleIndex]?.title || '')}</h3><p>${esc(item.question)}</p><div class="answer-box"><strong>Ключ ответа</strong><br>${esc(item.answer)}</div>`).join('')}`, 'Тесты с ключами');
  } else if (tab === 'tasks') {
    const entries = course.tasks?.length ? course.tasks : [{text:course.task,criteria:'Корректность, обоснованность и воспроизводимость решения',moduleIndex:0}];
    canvas.innerHTML = paperFrame(`<span class="section-number">ПРАКТИЧЕСКИЕ МАТЕРИАЛЫ</span><h2>Практические задания</h2><div class="paper-subtitle">${esc(course.title)}</div>${entries.map((item,i)=>`<h3>${i+1}. ${esc(course.modules[item.moduleIndex]?.title || '')}</h3><p class="preserve-lines">${esc(item.text)}</p><div class="answer-box"><strong>Критерии оценки</strong><br>${esc(item.criteria)}</div>`).join('')}`, 'Практические задания');
  } else {
    const entries = course.slides?.length ? course.slides : [course.slide];
    canvas.innerHTML = entries.map((item,i)=>`<article class="slide-preview" style="zoom:${zoom / 100}"><small>МЕТОДИСТ / ${esc(course.title.toUpperCase())}</small><h2>${esc(item.title)}</h2><p class="preserve-lines">${esc(item.body)}</p><footer>Слайд ${i+1} из ${entries.length} · Черновик</footer></article>`).join('');
  }
}
function materialEntry(item,index) {
  const fields = tab==='tests' ? [['question','Вопрос'],['answer','Ключ ответа']] : tab==='tasks' ? [['text','Условие задания'],['criteria','Критерии оценки']] : [['title','Заголовок слайда'],['body','Содержание слайда']];
  return `<fieldset class="material-entry" data-entry><legend>Материал ${index+1}</legend><label>Модуль<select name="moduleIndex">${course.modules.map((m,i)=>`<option value="${i}" ${i===item.moduleIndex?'selected':''}>${esc(m.title)}</option>`).join('')}</select></label>${fields.map(([field,label])=>`<label>${label}<textarea name="${field}" required maxlength="${field==='text'?12000:field==='body'?8000:field==='title'?160:(field==='question'||field==='answer')?3000:4000}">${esc(item[field] || '')}</textarea></label>`).join('')}<button type="button" class="text-button" data-action="remove-entry">Убрать материал</button></fieldset>`;
}
function renderEditor() {
  let fields = '';
  if (tab === 'program') fields = `<label for="edit-title">Название программы</label><input id="edit-title" name="title" value="${esc(course.title)}" required maxlength="160"><label for="edit-goal">Цель программы</label><textarea id="edit-goal" name="goal" required maxlength="4000">${esc(course.goal)}</textarea><label for="edit-competencies">Результаты обучения — каждый с новой строки</label><textarea id="edit-competencies" name="competencies" required>${esc((course.competencies || []).join('\n'))}</textarea><div class="module-head"><span>Модули программы</span><span>Часы</span></div><div id="module-rows">${course.modules.map((module,index)=>moduleRow(module,index)).join('')}</div><button type="button" class="text-button" data-action="add-module">${icon('plus')}Добавить модуль</button>`;
  else {
    if (!course.modules.length) { $('#document-canvas').innerHTML='<div class="empty-state"><h3>Сначала добавьте модули программы</h3><p>Каждый материал должен быть связан с модулем.</p><button class="button" data-action="program-editor">Редактировать программу</button></div>';return; }
    let entries = course[tab] || [];
    if (!entries.length && tab==='tests' && course.question) entries=[{question:course.question,answer:course.answer,moduleIndex:0}];
    if (!entries.length && tab==='tasks' && course.task) entries=[{text:course.task,criteria:'Корректность решения',moduleIndex:0}];
    if (!entries.length && tab==='slides' && course.slide?.title) entries=[{...course.slide,moduleIndex:0}];
    fields=`<div id="material-rows">${entries.map(materialEntry).join('')}</div><button type="button" class="text-button" data-action="add-entry">${icon('plus')}Добавить материал</button>`;
  }
  $('#document-canvas').innerHTML = `<form class="editor" id="editor-form"><h2>${names[tab]}</h2><p class="editor-intro">После сохранения правки записываются на сервер. Каркас проверяется автоматически.</p>${fields}<p class="inline-error" id="editor-error" role="alert"></p><div class="editor-actions"><button type="button" class="button" data-action="cancel-edit">Отменить</button><button type="submit" class="button primary">${icon('check')}Сохранить правки</button></div></form>`;
}

function moduleRow(module, index) {
  return `<div class="module-row"><input name="module-title" aria-label="Название модуля ${index + 1}" value="${esc(module.title)}" required maxlength="160"><input name="module-hours" aria-label="Часы модуля ${index + 1}" type="number" min="1" max="500" value="${module.hours}" required><button type="button" class="icon-button" data-action="remove-module" aria-label="Убрать модуль ${index + 1}">${icon('close')}</button><textarea name="module-content" aria-label="Содержание модуля ${index+1}" placeholder="Содержание модуля — можно добавить после согласования">${esc(module.content || '')}</textarea></div>`;
}
function renderChat() {
  $('#chat-messages').innerHTML = messages.map(message => `<div class="message ${message.role}">${message.role === 'assistant' ? '<img class="message-avatar" src="assets/logo.svg" alt="ИИ-помощник">' : ''}<div class="bubble"><p>${esc(message.text)}</p>${message.proposal && proposal ? `<button class="proposal-link" data-action="proposal">${icon('layers')}Посмотреть изменения${icon('arrow-right')}</button>` : ''}${message.time ? `<span class="message-time">${esc(message.time)}</span>` : ''}</div></div>`).join('') + (busy ? '<div class="message"><div class="bubble" role="status">Модель готовит предложение. Курс сохранён на сервере…</div></div>' : '');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function renderAttachments() {
  $('#attachments').innerHTML = attachments.map((file, index) => `<span class="attachment">${icon('file')}${esc(file.name)} · локально<button data-action="remove-attachment" data-index="${index}" aria-label="Убрать ${esc(file.name)}">${icon('close')}</button></span>`).join('');
}
function openDialog(title, content, footer = '') {
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Закрыть">${icon('close')}</button></div>${content}${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!$('#main-dialog').open) $('#main-dialog').showModal();
}
function showProposal() {
  if (!proposal) return toast('Нет предложений для подтверждения.');
  const patch=proposal.patch;
  openDialog('Предлагаемые изменения', `<p class="dialog-note">Ответ модели сохранён как предложение. До подтверждения текущая программа не изменится.</p><p class="inline-error">${proposal.revision!==savedVersion ? 'Предложение относится к старой версии. Подготовьте его заново.' : ''}</p><table class="change-table"><thead><tr><th>Модуль</th><th>Сейчас</th><th>После принятия</th></tr></thead><tbody>${patch.modules.map((m,i)=>`<tr><td>${esc(m.title)}</td><td>${course.modules[i]?.hours ?? '—'} ч</td><td>${m.hours} ч</td></tr>`).join('')}</tbody></table><div class="change-description"><strong>Цель</strong><p>${esc(patch.goal)}</p><strong>Результаты обучения</strong>${patch.competencies.map(value=>`<p>${esc(value)}</p>`).join('')}<p>Тестов: ${patch.tests.length} · заданий: ${patch.tasks.length} · слайдов: ${patch.slides.length}</p>${patch.modules.filter(m=>m.content).map(m=>`<details><summary>${esc(m.title)} — содержание</summary><p class="preserve-lines">${esc(m.content)}</p></details>`).join('')}<details><summary>Тесты и ключи</summary>${patch.tests.map(t=>`<p>${esc(t.question)}<br>Ответ: ${esc(t.answer)}</p>`).join('')}</details><details><summary>Задания и критерии</summary>${patch.tasks.map(t=>`<p>${esc(t.text)}<br>Критерии: ${esc(t.criteria)}</p>`).join('')}</details><details><summary>Слайды</summary>${patch.slides.map(t=>`<p><strong>${esc(t.title)}</strong><br>${esc(t.body)}</p>`).join('')}</details></div><p class="inline-error" id="proposal-error" role="alert"></p>`, '<button class="button" data-action="reject-proposal">Отклонить</button><button class="button primary" data-action="accept-proposal">Применить пакет</button>');
}
function showExport() {
  openDialog('Экспорт комплекта', `<p class="dialog-note">${esc(course.title)} · ${course.hours} ч · версия ${savedVersion}<br>Скачивается сохранённая версия. Содержание и источники требуют проверки экспертом.</p><div class="export-option">${icon('file')}<div><h3>Данные программы</h3><p>JSON · параметры, материалы и проверки</p></div><button class="button compact" data-action="download-json">Скачать JSON</button></div><div class="export-option">${icon('file')}<div><h3>Программа и материалы</h3><p>DOCX · учебный план, содержание, тесты и задания</p></div><button class="button compact" data-action="download-docx">Скачать DOCX</button></div><div class="export-option">${icon('file')}<div><h3>Текущий материал</h3><p>Печать или сохранение в PDF через браузер</p></div><button class="button compact" data-action="print">Печать / PDF</button></div><p class="dialog-note">PPTX и проверка источников появятся на следующем этапе. DOCX пока использует базовую структуру; шаблон АЦР ещё не подключён.</p>`);
}
function showNewCourse() {
  openDialog('Новая программа', `<p class="dialog-note">Программа сохранится на сервере. После создания можно сформировать каркас через ИИ или заполнить его вручную.</p><form class="new-form" id="new-course-form"><label for="new-title">Название программы</label><input id="new-title" name="title" placeholder="Например, Основы Python" required maxlength="160"><label for="new-audience">Для кого программа</label><input id="new-audience" name="audience" placeholder="Например, начинающие аналитики" required maxlength="200"><label for="new-type">Тип программы</label><select id="new-type" name="type"><option>Повышение квалификации</option><option>Общеразвивающая</option><option>Стажировка</option></select><label for="new-hours">Объём, часов</label><input id="new-hours" name="hours" type="number" min="16" max="500" value="16" required><p class="inline-error" id="new-course-error" role="alert"></p><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Отмена</button><button class="button primary" type="submit">Создать программу${icon('arrow-right')}</button></div></form>`);
}

function guardDirty() { if (!dirty) return true; toast('Сохраните правки или нажмите «Отменить» в редакторе.'); return false; }
function changeCourse(patch) { course = updateCourse(course, patch); markSession(); shell(); renderChecks(); }
function downloadLocalBackup() {
  const blob=new Blob([JSON.stringify({schemaVersion:2,unsaved:true,course},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='metodist-unsaved.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function updateControls() {
  for (const selector of ['[data-action="new-course"]','[data-action="courses"]','#send-button','#generate-skeleton','#generate-materials']) {
    const element=$(selector);if (element)element.disabled=!initialized||busy;
  }
  $('#generate-materials').disabled=!initialized||busy||!course.approved;
  $('#approve-button').disabled = !initialized||busy||course.approved||!validate(course).hours.valid||!validate(course).structure.valid||!course.competencies?.length;
  $('#chat-input').disabled=!initialized;
  for (const field of $('#parameters-form').elements)field.disabled=!initialized;
}
function updateSaveUI() {
  $('#save-error').hidden=!saveError;
  if (saveError) $('#save-error').innerHTML=`<p>${esc(saveError.message)}</p><button class="text-button" data-action="retry-save">Повторить сохранение</button> <button class="text-button" data-action="reload-saved">Открыть сохранённую</button> <button class="text-button" data-action="backup">Скачать мои правки</button>`;
  $('#session-status').innerHTML=saveError ? `${icon('warning')} Не сохранено` : pendingSaves ? `${icon('clock')} Сохраняю…` : `${icon('check')} Сохранено на этом Mac`;
  if (!pendingSaves&&!saveError)sessionChanged=false;
  updateControls();
}
function queueSave() {
  if (!initialized||!recordId)return;
  const snapshot=course;const id=recordId;pendingSaves++;updateSaveUI();
  saveQueue=saveQueue.then(async()=>{
    if (saveError)return;
    try {
      const record=await request(`/courses/${id}`,{method:'PUT',body:{revision:savedVersion,course:snapshot}});
      savedVersion=record.revision;
      if (course===snapshot)course=record.course;
      shell();renderChecks();
    } catch(error) {saveError=error;}
  }).finally(()=>{pendingSaves--;updateSaveUI();});
}
async function flushed() {
  await saveQueue;
  if(saveError){toast('Сначала сохраните правки или откройте сохранённую версию.');return false;}
  return initialized;
}
function applyRecord(record) {
  course=record.course;recordId=record.id;savedVersion=record.revision;proposal=record.proposal;
  saveError=null;sessionChanged=false;dirty=false;
  history.replaceState(null,'',`?course=${encodeURIComponent(recordId)}`);
  renderParameters();renderDocument();updateSaveUI();
  $('#service-label').innerHTML=`<span></span>${course.isDemo?'Демо-пример · ':''}SQLite · сохранение на этом Mac`;
}
function proposalMessage() {
  messages.forEach(message=>{message.proposal=false;});
  if(proposal)messages.push({role:'assistant',text:'Предложение модели готово. Посмотрите весь пакет перед применением.',proposal:true});
}
async function pollJob(jobId,token) {
  try {
    while(token===generationToken) {
      await new Promise(resolve=>setTimeout(resolve,1000));
      const record=await request(`/courses/${recordId}`);
      if(token!==generationToken)return;
      if(record.job?.id!==jobId)throw new Error('Состояние запуска изменилось. Откройте программу заново.');
      if(record.job.status==='running')continue;
      busy=false;proposal=record.proposal;updateControls();renderChecks();
      if(record.job.status==='failed'){
        $('#generation-error').textContent=record.job.error;
        messages.push({role:'assistant',text:record.job.error});
      }else{proposalMessage();}
      renderChat();return;
    }
  }catch(error){busy=false;updateControls();$('#generation-error').textContent=error.message;renderChat();}
}
async function startGeneration(stage,prompt='') {
  if(busy||!guardDirty()||!await flushed())return;
  if(!$('#parameters-form').reportValidity())return;
  $('#generation-error').textContent='';$('#chat-error').textContent='';
  busy=true;updateControls();renderChat();
  try{
    const job=await request(`/courses/${recordId}/generate`,{method:'POST',body:{revision:savedVersion,stage,prompt,requestId:crypto.randomUUID()}});
    const token=++generationToken;
    pollJob(job.id,token);
  }catch(error){busy=false;updateControls();$('#generation-error').textContent=error.message;messages.push({role:'assistant',text:error.message});renderChat();}
}
async function showCourses() {
  if(!guardDirty()||!await flushed())return;
  try{
    const result=await request('/courses');
    openDialog('Мои программы',`<p class="dialog-note">Программы хранятся в локальной базе SQLite.</p><div class="course-list">${result.courses.map(record=>`<button class="course-list-item" data-action="open-course" data-id="${esc(record.id)}"><strong>${esc(record.title)}</strong><span>Версия ${record.revision} · ${new Date(record.updatedAt).toLocaleString('ru-RU')}</span>${icon('arrow-right')}</button>`).join('')}</div>`);
  }catch(error){toast(error.message);}
}
async function loadCourse(id) {
  const record=await request(`/courses/${id}`);
  generationToken++;busy=record.job?.status==='running';tab='program';view='preview';attachments=[];renderAttachments();
  applyRecord(record);
  messages=[{role:'assistant',text:course.isDemo?'Открыт демонстрационный пример. Создайте свою программу или измените этот курс.':'Программа загружена из базы. Можно редактировать её, согласовать каркас или запросить изменения.'}];
  proposalMessage();renderChat();
  $('#generation-error').textContent=record.job?.status==='failed'?record.job.error:'';
  if(busy)pollJob(record.job.id,generationToken);
}
async function boot() {
  try{
    const status=await request('/status');
    $('#provider-badge').textContent=status.provider;
    const result=await request('/courses');
    const requestedId=new URL(location.href).searchParams.get('course');
    initialized=true;
    if(requestedId||result.courses.length)await loadCourse(requestedId||result.courses[0].id);
    else {
      const record=await request('/courses',{method:'POST',body:{course}});
      await loadCourse(record.id);
    }
    if(!status.configured)$('#generation-error').textContent='Ключ модели не настроен на сервере. Сохранение и ручной редактор доступны.';
  }catch(error){initialized=false;$('#save-error').hidden=false;$('#save-error').innerHTML=`<p>${esc(error.message)}</p><button class="text-button" data-action="retry-boot">Повторить подключение</button><button class="text-button" data-action="reset-route">Открыть список программ</button>`;$('#session-status').textContent='Нет подключения';updateControls();}
}

document.addEventListener('click',async event=>{
  const tabButton=event.target.closest('[data-tab]');
  if(tabButton&&guardDirty()){tab=tabButton.dataset.tab;renderDocument();return;}
  const viewButton=event.target.closest('[data-view]');
  if(viewButton&&guardDirty()){view=viewButton.dataset.view;renderDocument();return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  try{
    if(action==='expand'){
      const panel=document.getElementById(target.dataset.panel);const expanded=panel.classList.toggle('expanded');
      target.innerHTML=icon(expanded?'collapse':'expand');target.setAttribute('aria-label',expanded?'Свернуть область':'Развернуть область');
    }
    if(action==='zoom-in'||action==='zoom-out'){zoom=Math.max(70,Math.min(150,zoom+(action==='zoom-in'?10:-10)));shell();if(tab==='slides')renderDocument();}
    if((action==='preview'||action==='editor')&&guardDirty()){view=action==='editor'?'editor':'preview';renderDocument();}
    if(action==='program-editor'&&guardDirty()){tab='program';view='editor';renderDocument();}
    if(action==='cancel-edit'){dirty=false;view='preview';renderDocument();}
    if(action==='new-course'&&guardDirty()&&await flushed())showNewCourse();
    if(action==='courses')await showCourses();
    if(action==='open-course'&&await flushed()){await loadCourse(target.dataset.id);$('#main-dialog').close();}
    if(action==='export'&&guardDirty()&&await flushed())showExport();
    if(action==='proposal'&&guardDirty()&&await flushed())showProposal();
    if(action==='close-dialog')$('#main-dialog').close();
    if((action==='download-json'||action==='download-docx')&&await flushed()){
      const link=document.createElement('a');link.href=`/api/courses/${recordId}/export.${action==='download-json'?'json':'docx'}`;link.download='';link.click();
    }
    if(action==='print'){$('#main-dialog').close();view='preview';renderDocument();window.print();}
    if(action==='attach'){$('#reference-input').click();toast('Референсы пока не передаются модели. Чтение файлов будет следующим этапом.');}
    if(action==='remove-attachment'){attachments.splice(Number(target.dataset.index),1);renderAttachments();}
    if(action==='add-module'){$('#module-rows').insertAdjacentHTML('beforeend',moduleRow({title:'',hours:1},$('#module-rows').children.length));dirty=true;$('#module-rows').lastElementChild.querySelector('input').focus();}
    if(action==='remove-module'){target.closest('.module-row').remove();dirty=true;}
    if(action==='add-entry'){$('#material-rows').insertAdjacentHTML('beforeend',materialEntry({moduleIndex:0},$('#material-rows').children.length));dirty=true;}
    if(action==='remove-entry'){target.closest('[data-entry]').remove();dirty=true;}
    if(action==='approve'&&guardDirty()&&await flushed()){
      target.disabled=true;applyRecord(await request(`/courses/${recordId}/approve`,{method:'POST',body:{revision:savedVersion}}));toast('Каркас согласован. Можно подготовить материалы.');
    }
    if(action==='generate-skeleton')await startGeneration('skeleton');
    if(action==='generate-materials')await startGeneration('materials');
    if(action==='reject-proposal'){
      target.disabled=true;await request(`/proposals/${proposal.id}/reject`,{method:'POST',body:{}});proposal=null;$('#main-dialog').close();messages.push({role:'assistant',text:'Предложение отклонено. Программа не изменена.'});renderChat();
    }
    if(action==='accept-proposal'&&guardDirty()&&await flushed()){
      target.disabled=true;
      try{const record=await request(`/proposals/${proposal.id}/accept`,{method:'POST',body:{revision:savedVersion}});applyRecord(record);$('#main-dialog').close();messages.push({role:'assistant',text:'Пакет применён и сохранён. Проверки выполнены; содержание требует экспертной проверки.'});renderChat();toast('Изменения сохранены в SQLite');}
      catch(error){$('#proposal-error').textContent=error.message;target.disabled=false;}
    }
    if(action==='backup')downloadLocalBackup();
    if(action==='retry-save'){saveError=null;queueSave();}
    if(action==='reload-saved')openDialog('Открыть сохранённую версию', '<p class="dialog-note">Текущие несохранённые правки будут заменены версией из SQLite. Можно сначала скачать свои правки.</p>','<button class="button" data-action="backup">Скачать мои правки</button><button class="button primary" data-action="confirm-reload">Открыть сохранённую</button>');
    if(action==='confirm-reload'){await saveQueue;await loadCourse(recordId);$('#main-dialog').close();}
    if(action==='retry-boot')await boot();
    if(action==='reset-route'){history.replaceState(null,'',location.pathname);await boot();}
  }catch(error){toast(error.message);renderChecks();}
});
$('#parameters-form').addEventListener('change',event=>{
  const field=event.target;if(!initialized)return;
  if(!field.checkValidity()){field.reportValidity();return;}
  const value=['hours','group'].includes(field.name)?Number(field.value):field.value;
  if(course[field.name]===value)return;
  if(!guardDirty()){field.value=course[field.name];return;}
  changeCourse({[field.name]:value});renderDocument();
  $('#parameter-notice').textContent='Параметры изменены. Проверьте каркас и согласуйте его повторно.';
});
document.addEventListener('input',event=>{if(event.target.closest('#editor-form')){dirty=true;$('#document-status').textContent='Есть несохранённые правки';}});
document.addEventListener('submit',async event=>{
  if(event.target.id==='editor-form'){
    event.preventDefault();const form=new FormData(event.target);let patch;
    if(tab==='program')patch={title:form.get('title').trim(),goal:form.get('goal').trim(),competencies:form.get('competencies').split('\n').map(v=>v.trim()).filter(Boolean),modules:[...document.querySelectorAll('.module-row')].map(row=>({title:row.querySelector('[name=module-title]').value.trim(),hours:Number(row.querySelector('[name=module-hours]').value),content:row.querySelector('[name=module-content]').value.trim()}))};
    else patch={[tab]:[...document.querySelectorAll('[data-entry]')].map(entry=>{const item={};for(const field of entry.querySelectorAll('textarea,select'))item[field.name]=field.name==='moduleIndex'?Number(field.value):field.value.trim();return item;})};
    if(Object.values(patch).some(value=>typeof value==='string'&&!value.trim())){$('#editor-error').textContent='Поля не могут состоять только из пробелов.';return;}
    dirty=false;changeCourse(patch);view='preview';renderDocument();
    if(await flushed())toast('Правки сохранены в SQLite. Каркас проверен.');
  }
  if(event.target.id==='new-course-form'){
    event.preventDefault();const form=new FormData(event.target);const button=event.target.querySelector('[type=submit]');button.disabled=true;
    try{
      const draft=createCourse({title:form.get('title').trim(),type:form.get('type'),hours:Number(form.get('hours')),fresh:true});draft.audience=form.get('audience').trim();
      const record=await request('/courses',{method:'POST',body:{course:draft}});$('#main-dialog').close();await loadCourse(record.id);messages=[{role:'assistant',text:'Программа создана и сохранена. Нажмите «Сформировать каркас» или опишите требования в чате.'}];renderChat();
    }catch(error){$('#new-course-error').textContent=error.message;button.disabled=false;}
  }
});
$('#chat-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!guardDirty())return;
  const input=$('#chat-input');const prompt=input.value.trim();
  if(!prompt){$('#chat-error').textContent='Напишите, что нужно изменить.';input.focus();return;}
  messages.push({role:'user',text:prompt});input.value='';renderChat();
  await startGeneration(course.modules.length?'revision':'skeleton',prompt);
});
$('#reference-input').addEventListener('change', event => {
  const errors = [];
  for (const file of event.target.files) {
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) { errors.push(`${file.name}: поддерживаются PDF, DOCX и TXT.`); continue; }
    if (file.size > 20 * 1024 * 1024) { errors.push(`${file.name}: больше 20 МБ.`); continue; }
    if (!attachments.some(item => item.name === file.name && item.size === file.size)) attachments.push({ name:file.name, size:file.size });
  }
  renderAttachments(); $('#chat-error').textContent = errors.join(' ');
  if ($('#new-files')) $('#new-files').textContent = errors.length ? errors.join(' ') : `Прикреплено файлов: ${attachments.length}. Файлы остаются на вашем устройстве.`;
  if (!errors.length) toast('Файлы прикреплены локально. Извлечение данных пока не подключено.');
  event.target.value = '';
});
$('#column-size').addEventListener('input', event => document.documentElement.style.setProperty('--left', `${event.target.value}%`));
$('#row-size').addEventListener('input', event => document.documentElement.style.setProperty('--top', `${event.target.value}%`));
// Pointer resizing supplements the native, keyboard-accessible range controls.
for (const [selector, axis] of [['.column-resizer','x'], ['.row-resizer','y']]) {
  const handle = $(selector);
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); const input = handle.querySelector('input'); input.focus(); handle.setPointerCapture(event.pointerId);
    const move = moveEvent => { const rect = (axis === 'x' ? $('#workspace') : $('#right-column')).getBoundingClientRect(); const position = axis === 'x' ? (moveEvent.clientX - rect.left) / rect.width : (moveEvent.clientY - rect.top) / rect.height; input.value = Math.round(position * 100); input.dispatchEvent(new Event('input')); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#main-dialog').open) { document.querySelectorAll('.panel.expanded').forEach(panel => { panel.classList.remove('expanded'); const button = panel.querySelector('[data-action=expand]'); button.innerHTML = icon('expand'); button.setAttribute('aria-label', 'Развернуть область'); button.focus(); }); } });
window.addEventListener('beforeunload', event => { if (dirty || sessionChanged || pendingSaves) { event.preventDefault(); event.returnValue = ''; } });
$('#session-status').innerHTML = `${icon('clock')} Подключаюсь…`;
$('#row-size').value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'));
decorate(); renderParameters(); renderDocument(); renderChat();
boot();
