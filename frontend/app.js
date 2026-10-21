import { createCourse, validate, updateCourse, clarificationQuestions, proposalWarnings } from './model.js';
import { request, createSourceCheck, createGenerationGuard, waitForJob } from './api.js';
import {hourFields,hourLabels,preserveModule} from './curriculum.js';
import {programProfile,inferProgramType,normativeEntries,suggestedNormativeSources,catalogDate,detailFields} from './programs.js';

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
const sourceChecks=new WeakMap();
const generationGuard=createGenerationGuard();
let course = createCourse();
let tab = 'program';
let view = 'preview';
let zoom = 100;
let busy = false;
let dirty = false;
let sessionChanged = false;
let proposal = null;
let pendingClarification=null;
let attachments = [];
let readingReferences=false;
let newModuleIndex=-1;
let messages = [];
let recordId = null;
let savedVersion = 0;
let saveQueue = Promise.resolve();
let pendingSaves = 0;
let saveError = null;
let initialized = false;
let requiresLogin=false,authenticated=true,publicDemo=false;
function writable(){return initialized&&(!requiresLogin||authenticated);}
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
  const ok = result.hours.valid && result.structure.valid && result.topicHours.valid && result.competencyMap.valid;
  $('#validation-summary').innerHTML = `<div class="check-summary ${ok ? '' : 'warning'}"><span>${icon(ok ? 'check' : 'warning')}${ok ? 'Каркас проверен' : 'Нужна правка каркаса'}</span><span>${icon(result.hours.valid ? 'check' : 'clock')}${result.hours.total} / ${course.hours} ч</span></div>`;
  $('#check-count').textContent = `${Object.values(result).filter(check=>!check.valid).length} замеч.`;
  $('#checks-list').innerHTML = [
    ['hours',result.hours.valid, 'Сумма часов', result.hours.valid ? 'Часы модулей совпадают с общим объёмом.' : 'Скорректируйте объём или часы модулей в редакторе.'],
    ['structure',result.structure.valid, 'Полнота каркаса', result.structure.valid ? 'Название, цель и модули заполнены.' : 'Заполните название, цель и добавьте модули.'],
    ['materials',result.materials.valid, 'Связанные материалы', course.materialsStale ? 'Каркас изменён. Материалы сохранены, но требуют обновления.' : result.materials.valid ? 'Для каждого модуля есть содержание, тесты, задания и слайды.' : 'Комплект неполный: нужны содержание, тесты, задания и слайды каждого модуля.'],
    ['topicHours',result.topicHours.valid, 'Часы тем и видов работы', result.topicHours.valid ? 'Суммы тем, модулей и видов работы совпадают.' : 'Добавьте темы и распределите часы по видам работы в редакторе.'],
    ['competencyMap',result.competencyMap.valid, 'Карта компетенций', 'Для каждого результата нужны знания, умения, навыки и раскрывающая его тема.'],
    ['coverage',result.coverage.valid, 'Покрытие результатов', 'Каждый результат должен быть связан с темой, тестом и семинарским заданием.'],
    ['lecturePlans',result.lecturePlans.valid, 'Планы лекций', 'Для модулей с лекциями нужен план занятия.'],
    ['materialCounts',result.materialCounts.valid,'Количество оценочных материалов и слайдов','На модуль нужны минимум 3 вопроса, 1 задание и 4–8 слайдов.'],
    ['contentDepth',result.contentDepth.valid,'Объём учебного текста','Проверка длины текста не заменяет предметную экспертизу. Краткий текст требует доработки.'],
    ['programSections',result.programSections.valid,'Разделы программы','Календарный график, условия, поступление, итоговый документ и нормативное обоснование заполняет методист.'],
    ['professionalStandards',result.professionalStandards.valid,'Профстандарты и трудовые функции','Для профессионального профиля нужны ручные подтверждения по каждому результату.'],
    ['normativeBasis',result.normativeBasis.valid,'Нормативные основания','Для выбранного типа нужны конкретные официальные документы и подтверждение их применимости методистом. Доступность ссылки не равна юридической проверке.'],
    ['sources',result.sources.valid, 'Источники', result.sources.valid ? 'Источники подтверждены методистом. Предметная корректность требует экспертной проверки.' : 'Добавьте источники и сведения об их проверке. Доступность HTTPS-ссылок можно проверить в «Источниках». Достоверность подтверждает методист.'],
  ].map(([key, valid, title, description]) => `<div class="check-item ${valid ? '' : 'warning'}">${icon(valid ? 'check' : 'warning')}<div><strong>${title}</strong><p>${description}</p>${(result[key].details || []).map(detail=>`<p>${esc(detail)}</p>`).join('')}</div></div>`).join('');
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
    canvas.querySelector('.paper-footer').insertAdjacentHTML('beforebegin',programSummary(course)+curriculumSummary(course));
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
  return `<fieldset class="material-entry" data-entry><legend>Материал ${index+1}</legend><label>Модуль<select name="moduleIndex">${course.modules.map((m,i)=>`<option value="${i}" ${i===item.moduleIndex?'selected':''}>${esc(m.title)}</option>`).join('')}</select></label>${outcomeSelect(item.competencyIndices || [])}${fields.map(([field,label])=>`<label>${label}<textarea name="${field}" required maxlength="${field==='text'?12000:field==='body'?8000:field==='title'?160:(field==='question'||field==='answer')?3000:4000}">${esc(item[field] || '')}</textarea></label>`).join('')}<button type="button" class="text-button" data-action="remove-entry">Убрать материал</button></fieldset>`;
}
function renderEditor() {
  let fields = '';
  if (tab === 'program') fields = `<label for="edit-title">Название программы</label><input id="edit-title" name="title" value="${esc(course.title)}" required maxlength="160"><label for="edit-goal">Цель программы</label><textarea id="edit-goal" name="goal" required maxlength="4000">${esc(course.goal)}</textarea><label for="edit-competencies">Результаты обучения — каждый с новой строки</label><textarea id="edit-competencies" name="competencies" required>${esc((course.competencies || []).join('\n'))}</textarea><div class="module-head"><span>Модули программы</span><span>Часы</span></div><div id="module-rows">${course.modules.map((module,index)=>moduleRow(module,index)).join('')}</div><button type="button" class="text-button" data-action="add-module">${icon('plus')}Добавить модуль</button><h3>Карта компетенций</h3><p>После добавления новых результатов сохраните программу, чтобы заполнить их карту.</p>${course.competencies.map((value,index)=>mapEditor(value,index)).join('')}<h3>Разделы программы — заполняет методист</h3>${Object.entries(detailFields).map(([key,label])=>`<label>${esc(label)}<textarea name="detail-${key}" maxlength="4000">${esc(course.programDetails?.[key] || '')}</textarea></label>`).join('')}<button type="button" class="button" data-action="sources">Источники и подтверждения</button>`;
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

function outcomeSelect(selected=[]) {
  return `<label>Результаты обучения (можно выбрать несколько)<select name="competencyIndices" multiple size="3">${course.competencies.map((v,i)=>`<option value="${i}" ${selected.includes(i)?'selected':''}>РО-${i+1}: ${esc(v)}</option>`).join('')}</select></label>`;
}
function topicEditor(topic={}) {
  return `<fieldset class="topic-entry"><legend>Тема</legend><label>Название темы<input name="topic-title" required maxlength="200" value="${esc(topic.title || '')}"></label><div class="hours-grid">${hourFields.map((key,i)=>`<label>${hourLabels[i]}<input name="${key}" type="number" min="0" max="500" required value="${topic[key] || 0}"></label>`).join('')}</div>${outcomeSelect(topic.competencyIndices)}<button type="button" class="text-button" data-action="remove-topic">Убрать тему</button></fieldset>`;
}
function mapEditor(value,index) {
  const entry=course.competencyMap?.find(x=>x.competencyIndex===index) || {};
  return `<fieldset class="competency-entry" data-index="${index}"><legend>РО-${index+1}: ${esc(value)}</legend>${[['knowledge','Знания'],['skills','Умения'],['abilities','Навыки']].map(([key,label])=>`<label>${label} — каждый пункт с новой строки<textarea name="${key}">${esc((entry[key] || []).join('\n'))}</textarea></label>`).join('')}<details><summary>Профстандарт и трудовая функция (ручная проверка)</summary>${['title','code','functionCode','url','evidence'].map(key=>`<label>${esc(({title:'Название',code:'Код профстандарта',functionCode:'Код трудовой функции',url:'Официальный URL',evidence:'Кто и как проверил'})[key])}<input name="standard-${key}" maxlength="2000" value="${esc(entry.professionalStandard?.[key] || '')}"></label>`).join('')}<label><input type="checkbox" name="standard-confirmed" ${entry.professionalStandard?.status==='confirmed'?'checked':''}>Подтверждено методистом</label></details></fieldset>`;
}
function moduleRow(module, index,originalIndex=index) {
  return `<div class="module-row" data-original-index="${originalIndex}"><input name="module-title" aria-label="Название модуля ${index + 1}" value="${esc(module.title)}" required maxlength="160"><input name="module-hours" aria-label="Часы модуля ${index + 1}" type="number" min="1" max="500" value="${module.hours}" required><button type="button" class="icon-button" data-action="remove-module" aria-label="Убрать модуль ${index + 1}">${icon('close')}</button><textarea name="module-content" aria-label="Содержание модуля ${index+1}" placeholder="Содержание модуля — после согласования">${esc(module.content || '')}</textarea><details class="module-detail"><summary>Темы, виды часов и план лекции</summary><div class="topic-rows">${(module.topics || []).map(topicEditor).join('')}</div><button type="button" class="text-button" data-action="add-topic">Добавить тему</button><label>План лекции<textarea name="lecturePlan" maxlength="12000">${esc(module.lecturePlan || '')}</textarea></label></details></div>`;
}
function programSummary(value) {
  const selected=programProfile(value);
  return `${Object.entries(detailFields).map(([key,label])=>`<h3>${esc(label)}</h3><p class="preserve-lines">${esc(value.programDetails?.[key] || 'НЕ ЗАПОЛНЕНО — требуется решение методиста.')}</p>`).join('')}<h3>Тип программы и нормативные основания</h3><p><strong>${esc(selected.heading)}</strong><br>Профиль: ${esc(selected.id)}. Каталог сверен ${esc(catalogDate)}.</p>${normativeEntries(value).map(x=>`<p><strong>${esc(x.title)}</strong><br>${x.status==='confirmed'?'Применимость подтверждена методистом':'НЕ ПОДТВЕРЖДЁН — методист проверяет редакцию и применимость'}<br>${esc(x.url)}<br>${esc(x.evidence)}</p>`).join('')}<p>${esc(selected.notice)}</p><p>Документ по итогам: ${esc(selected.document)}.</p><p>Точное оформление АЦР не сверено с официальными образцами. Календарные даты, условия обучения и реквизиты заполняются перед утверждением.</p>`;
}
function curriculumSummary(value) {
  return `<h3>Карта компетенций</h3>${(value.competencyMap || []).map(item=>`<p><strong>РО-${item.competencyIndex+1}</strong><br>Знания: ${esc(item.knowledge.join('; '))}<br>Умения: ${esc(item.skills.join('; '))}<br>Навыки: ${esc(item.abilities.join('; '))}</p>`).join('') || '<p>Карта не заполнена</p>'}<h3>Учебно-тематический план</h3>${value.modules.map((m,i)=>`<h4>${i+1}. ${esc(m.title)}</h4>${(m.topics || []).map((t,j)=>`<p><strong>${i+1}.${j+1}. ${esc(t.title)}</strong><br>${hourFields.map((k,n)=>`${hourLabels[n]}: ${t[k]} ч`).join(' · ')}<br>Результаты: ${(t.competencyIndices || []).map(n=>`РО-${n+1}`).join(', ')}</p>`).join('') || '<p>Темы не заполнены</p>'}${m.lecturePlan?`<details><summary>План лекции</summary><p class="preserve-lines">${esc(m.lecturePlan)}</p></details>`:''}`).join('')}<h3>Связи оценочных средств</h3>${['tests','tasks'].map(name=>`<p>${name==='tests'?'Тесты':'Задания'}: ${(value[name] || []).map((x,i)=>`${i+1} → ${(x.competencyIndices || []).map(n=>`РО-${n+1}`).join(', ') || 'нет связи'}`).join('; ') || 'не подготовлены'}</p>`).join('')}<h3>Источники</h3>${(value.sources || []).map(x=>`<p><strong>${esc(x.title)}</strong> · ${x.status==='confirmed'?'подтверждён методистом':'не подтверждён'}<br>${esc(x.url)}<br>${esc(x.evidence)}</p>`).join('') || '<p>Источники не подтверждены</p>'}`;
}
function showSources() {
  openDialog('Источники и подтверждения',`<p class="dialog-note">Указывайте только реально проверенные документы и ссылки. Отметка означает вашу проверку достоверности. Кнопка «Проверить HTTPS-ссылку» проверяет доступность публичной страницы, без перенаправлений и скачивания текста. Результат временный и не сохраняется в программе. Неподтверждённые записи отмечены в отчёте и отдельном разделе DOCX/PPTX; в проверенную литературу они не включаются.</p><form id="sources-form"><button type="button" class="button" data-action="add-normative-sources">Добавить нормативные основания выбранного типа</button><p class="dialog-note">Записи добавляются без подтверждения. Проверьте первоисточники и применимость; затем укажите, кто и как их проверил.</p><div id="source-rows">${(course.sources || []).map(sourceEditor).join('')}</div><button type="button" class="text-button" data-action="add-source">Добавить источник</button><p id="sources-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">Сохранить источники</button></form>`);
}
function sourceEditor(item={}) {
  return `<fieldset class="source-entry"><legend>Источник</legend><label>Название<input name="title" required maxlength="2000" value="${esc(item.title || '')}"></label><label>Ссылка (для печатного документа можно оставить пустой)<input name="url" type="url" value="${esc(item.url || '')}"></label><label>Кто, когда и по какому первоисточнику проверил<textarea name="evidence" maxlength="2000">${esc(item.evidence || '')}</textarea></label><button type="button" class="button compact" data-action="check-source">Проверить HTTPS-ссылку</button><p class="source-check-result dialog-note" role="status" aria-live="polite"></p><label><input type="checkbox" name="confirmed" ${item.status==='confirmed'?'checked':''}>Я проверил источник</label><button type="button" class="text-button" data-action="remove-source">Убрать источник</button></fieldset>`;
}

async function checkSource(entry) {
  const field=entry.querySelector('[name=url]');
  const button=entry.querySelector('[data-action=check-source]');
  const output=entry.querySelector('.source-check-result');
  const checker=sourceChecks.get(entry) || createSourceCheck();sourceChecks.set(entry,checker);
  const checkedUrl=field.value.trim();
  if(!checkedUrl){output.textContent='Укажите публичную HTTPS-ссылку.';field.focus();return;}
  if(!field.reportValidity())return;
  button.disabled=true;output.textContent='Проверяю доступность страницы…';
  const current=()=>entry.isConnected && field.value.trim()===checkedUrl;
  try {
    const result=await checker.run(checkedUrl);
    if(result && current())output.textContent=`${result.httpStatus==null?'':`HTTP ${result.httpStatus}. `}${result.message} Проверено: ${new Date(result.checkedAt).toLocaleString('ru-RU')}.`;
  } catch(error) {if(current())output.textContent=error.message;}
  finally {if(entry.isConnected)button.disabled=false;}
}

function renderChat() {
  $('#chat-messages').innerHTML = messages.map(message => `<div class="message ${message.role}">${message.role === 'assistant' ? '<img class="message-avatar" src="assets/logo.svg" alt="ИИ-помощник">' : ''}<div class="bubble"><p>${esc(message.text)}</p>${message.proposal && proposal ? `<button class="proposal-link" data-action="proposal">${icon('layers')}Посмотреть изменения${icon('arrow-right')}</button>` : ''}${message.time ? `<span class="message-time">${esc(message.time)}</span>` : ''}</div></div>`).join('') + (busy ? '<div class="message"><div class="bubble" role="status">Модель готовит предложение. Курс сохранён на сервере…</div></div>' : '');
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function renderAttachments() {
  $('#attachments').innerHTML = (course.references || []).map((file,index)=>`<span class="attachment"><button class="text-button" data-action="view-reference" data-index="${index}">${esc(file.name)} · ${file.text.length} зн.</button><button data-action="remove-attachment" data-index="${index}" aria-label="Убрать ${esc(file.name)}">${icon('close')}</button></span>`).join('');
}

function openDialog(title, content, footer = '') {
  $('#dialog-content').innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Закрыть">${icon('close')}</button></div>${content}${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!$('#main-dialog').open) $('#main-dialog').showModal();
}
function showProposal() {
  if (!proposal) return toast('Нет предложений для подтверждения.');
  const patch=proposal.patch;
  const warnings=proposalWarnings(patch,proposal.stage);
  const review=`<h3>Проверки предложения</h3>${warnings.length ? `<p class="inline-error">Черновик содержит замечания. Просмотрите их перед применением.</p>${warnings.map(x=>`<p><strong>${esc(x.title)}</strong>${x.details.map(detail=>`<br>${esc(detail)}`).join('')}</p>`).join('')}` : '<p>Автоматические проверки этого этапа пройдены. Содержание проверяет эксперт.</p>'}`;
  openDialog('Предлагаемые изменения', `<p class="dialog-note">Ответ модели сохранён как предложение. До подтверждения текущая программа не изменится.</p><p class="inline-error">${proposal.revision!==savedVersion ? 'Предложение относится к старой версии. Подготовьте его заново.' : ''}</p><table class="change-table"><thead><tr><th>Модуль</th><th>Сейчас</th><th>После принятия</th></tr></thead><tbody>${patch.modules.map((m,i)=>`<tr><td>${esc(m.title)}</td><td>${course.modules[i]?.hours ?? '—'} ч</td><td>${m.hours} ч</td></tr>`).join('')}</tbody></table>${review}<div class="change-description"><strong>Цель</strong><p>${esc(patch.goal)}</p><strong>Результаты обучения</strong>${patch.competencies.map(value=>`<p>${esc(value)}</p>`).join('')}<p>Тестов: ${patch.tests.length} · заданий: ${patch.tasks.length} · слайдов: ${patch.slides.length}</p>${curriculumSummary(patch)}${patch.modules.filter(m=>m.content).map(m=>`<details><summary>${esc(m.title)} — содержание</summary><p class="preserve-lines">${esc(m.content)}</p></details>`).join('')}<details><summary>Тесты и ключи</summary>${patch.tests.map(t=>`<p>${esc(t.question)}<br>Ответ: ${esc(t.answer)}</p>`).join('')}</details><details><summary>Задания и критерии</summary>${patch.tasks.map(t=>`<p>${esc(t.text)}<br>Критерии: ${esc(t.criteria)}</p>`).join('')}</details><details><summary>Слайды</summary>${patch.slides.map(t=>`<p><strong>${esc(t.title)}</strong><br>${esc(t.body)}</p>`).join('')}</details></div><p class="inline-error" id="proposal-error" role="alert"></p>`, `<button class="button" data-action="reject-proposal">Отклонить</button><button class="button primary" data-action="accept-proposal">${warnings.length?'Применить черновик с замечаниями':'Применить пакет'}</button>`);
}
function showExport() {
  openDialog('Экспорт комплекта', `<p class="dialog-note">${esc(course.title)} · ${course.hours} ч · версия ${savedVersion}<br>Скачивается сохранённая версия. Содержание и источники требуют проверки экспертом.</p><div class="export-option">${icon('file')}<div><h3>Данные программы</h3><p>JSON · параметры, материалы и проверки</p></div><button class="button compact" data-action="download-json">Скачать JSON</button></div><div class="export-option">${icon('file')}<div><h3>Программа и материалы</h3><p>DOCX · учебный план, содержание, тесты и задания</p></div><button class="button compact" data-action="download-docx">Скачать DOCX</button></div><div class="export-option">${icon('file')}<div><h3>Текущий материал</h3><p>Печать или сохранение в PDF через браузер</p></div><button class="button compact" data-action="print">Печать / PDF</button></div><div class="export-option"><div><h3>Слайды лекций</h3><p>PPTX · редактируемые слайды и заметки</p></div><button class="button compact" data-action="download-pptx">Скачать PPTX</button></div><div class="export-option"><div><h3>Тесты для LMS</h3><p>Moodle XML · вопросы с открытым ответом и ключи для преподавателя</p></div><button class="button compact" data-action="download-moodle.xml">Скачать Moodle XML</button></div><p class="dialog-note">DOCX содержит разделы выбранного типа программы. Точное соответствие шаблонам АЦР ещё не сверено. Перед использованием нужны проверка содержания, нормативной базы и источников.</p>`);
}
function showNewCourse() {
  openDialog('Новая программа', `<p class="dialog-note">Программа сохранится на сервере. После создания можно сформировать каркас через ИИ или заполнить его вручную.</p><form class="new-form" id="new-course-form"><label for="new-request">Запрос методиста</label><textarea id="new-request" name="request" maxlength="8000" placeholder="Например: общеразвивающая программа по Python на 24 часа"></textarea><p id="type-inference" class="dialog-note" role="status">Тип определяется по явному указанию в запросе. При неоднозначности выберите его вручную.</p><label for="new-title">Название программы</label><input id="new-title" name="title" placeholder="Например, Основы Python" required maxlength="160"><label for="new-audience">Для кого программа</label><input id="new-audience" name="audience" placeholder="Например, начинающие аналитики" required maxlength="200"><label for="new-level">Входной уровень слушателей</label><input id="new-level" name="level" required maxlength="200" placeholder="Например, без опыта программирования"><label for="new-type">Тип программы</label><select id="new-type" name="type"><option value="">Автоматически по запросу</option><option>Повышение квалификации</option><option>Общеразвивающая</option><option>Стажировка</option></select><label for="new-hours">Объём, часов</label><input id="new-hours" name="hours" type="number" min="16" max="500" value="16" required><label for="new-assessment">Форма итоговой аттестации</label><select id="new-assessment" name="assessment" required><option value="">Выберите форму аттестации</option><option>Защита проекта</option><option>Тестирование</option><option>Практическое задание</option></select><p class="inline-error" id="new-course-error" role="alert"></p><div class="dialog-footer"><button type="button" class="button" data-action="close-dialog">Отмена</button><button class="button primary" type="submit">Создать программу${icon('arrow-right')}</button></div></form>`);
}

function guardDirty() { if (!dirty) return true; toast('Сохраните правки или нажмите «Отменить» в редакторе.'); return false; }
function changeCourse(patch) { course = updateCourse(course, patch); markSession(); shell(); renderChecks(); }
function downloadLocalBackup() {
  const blob=new Blob([JSON.stringify({schemaVersion:3,unsaved:true,course},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='metodist-unsaved.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function showAccess(){openDialog('Доступ команды',`<p class="dialog-note">Демо открыто для просмотра. Пароль команды нужен для создания, изменения программ и платной генерации. Все материалы демо публичны: загружайте только открытые учебные данные.</p><form id="access-form"><label for="team-password">Пароль команды</label><input id="team-password" name="password" type="password" autocomplete="current-password" required maxlength="200"><p id="access-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">Войти</button></form>`);}
function updateControls() {
  for (const selector of ['[data-action="new-course"]','[data-action="attach"]','#send-button','#generate-skeleton','#generate-materials']) {
    const element=$(selector);if (element)element.disabled=!writable()||busy||generationGuard.active||readingReferences;
  }
  document.querySelector('[data-action="courses"]').disabled=!initialized||busy||generationGuard.active||readingReferences;
  $('#generate-materials').disabled=!writable()||busy||generationGuard.active||!course.approved;
  $('#approve-button').disabled = !writable()||busy||course.approved||!validate(course).hours.valid||!validate(course).structure.valid||!validate(course).topicHours.valid||!validate(course).competencyMap.valid;
  $('#chat-input').disabled=!writable()||readingReferences;
  $('#access-button').hidden=!requiresLogin;$('#access-button').textContent=authenticated?'Выйти':'Войти команде';
  document.querySelectorAll('[data-action="editor"],[data-view="editor"],[data-action="sources"]').forEach(button=>button.disabled=!writable());
  document.querySelector('[data-action="export"]').disabled=!initialized;
  const moduleButton=document.querySelector('[data-action="revise-module"]');if(moduleButton)moduleButton.disabled=!writable()||busy||generationGuard.active||!course.approved||!validate(course).materials.valid;
  for (const field of $('#parameters-form').elements)field.disabled=!writable();
}
function updateSaveUI() {
  $('#save-error').hidden=!saveError;
  if (saveError) $('#save-error').innerHTML=`<p>${esc(saveError.message)}</p><button class="text-button" data-action="retry-save">Повторить сохранение</button> <button class="text-button" data-action="reload-saved">Открыть сохранённую</button> <button class="text-button" data-action="backup">Скачать мои правки</button>`;
  $('#session-status').innerHTML=saveError ? `${icon('warning')} Не сохранено` : pendingSaves ? `${icon('clock')} Сохраняю…` : requiresLogin&&!authenticated?'Просмотр':`${icon('check')} Сохранено на сервере`;
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
  renderParameters();renderDocument();renderAttachments();updateSaveUI();
  $('#service-label').innerHTML=`<span></span>${publicDemo?'Публичное демо · материалы открыты; правки после входа':`${course.isDemo?'Демо-пример · ':''}SQLite · сохранение на сервере`}`;
}
function runSummary(job) {
  const m=job?.metrics;if(!m)return '';
  return `Запуск: ${m.seconds} с. Токены: ${m.inputTokens ?? 'нет данных'} вход / ${m.outputTokens ?? 'нет данных'} выход.${m.estimatedRub==null?'':` Оценка стоимости: ${m.estimatedRub.toFixed(4)} ₽ по тарифу ${m.tariffDate}; это не счёт провайдера.`}${m.usageComplete===false?' Usage получен не для всех вызовов; стоимость неполная.':''}`;
}
function proposalMessage() {
  messages.forEach(message=>{message.proposal=false;});
  if(proposal)messages.push({role:'assistant',text:'Предложение модели готово. Посмотрите весь пакет перед применением.',proposal:true});
}
async function pollJob(jobId,token) {
  try {
    const record=await waitForJob(recordId,jobId,{
      isCurrent:()=>token===generationToken,
      onConnectionChange:error=>{$('#generation-error').textContent=error?'Не удалось получить статус. Восстанавливаю связь с сервером…':'';},
    });
    if(!record)return;
    busy=false;
    if(!dirty&&!pendingSaves&&!saveError&&record.revision>=savedVersion)applyRecord(record);
    else proposal=record.proposal;
    updateControls();renderChecks();
    if(record.job.status==='failed'){
      $('#generation-error').innerHTML=`${esc(record.job.error)} <button class="text-button" data-action="reload-saved">Открыть сохранённую версию</button>`;
      messages.push({role:'assistant',text:record.job.error});
    }else{proposalMessage();}
    const summary=runSummary(record.job);if(summary)messages.push({role:'assistant',text:summary});
    renderChat();
  }catch(error){if(token!==generationToken)return;busy=false;updateControls();$('#generation-error').innerHTML=`${esc(error.message)} <button class="text-button" data-action="reload-saved">Открыть сохранённую версию и состояние запуска</button>`;renderChat();}
}

async function startGeneration(stage,prompt='',moduleIndex=null) {
  if(generationGuard.active)return;
  return generationGuard.run(async()=>{
    updateControls();
    if(busy||readingReferences||!guardDirty()||!await flushed())return;
    const questions=clarificationQuestions(course);
    if(questions.length){
      pendingClarification={courseId:recordId,stage,prompt,moduleIndex};
      messages.push({role:'assistant',text:'Перед генерацией уточним требования:\n'+questions.map(x=>x.question).join('\n')});renderChat();
      openDialog('Уточним требования к программе',`<form id="clarification-form">${questions.map(x=>`<label>${esc(x.question)}<input name="${x.field}" required maxlength="${x.field==='duration'?80:200}"></label>`).join('')}<p class="dialog-note">Ответы сохранятся в параметрах, затем подготовка продолжится с исходным запросом.</p><p id="clarification-error" class="inline-error" role="alert"></p><button class="button primary" type="submit">Сохранить и продолжить</button></form>`);
      return;
    }
    pendingClarification=null;
    if(!$('#parameters-form').reportValidity())return;
    $('#generation-error').textContent='';$('#chat-error').textContent='';
    busy=true;updateControls();renderChat();
    try{
      const job=await request(`/courses/${recordId}/generate`,{method:'POST',body:{revision:savedVersion,stage,prompt,moduleIndex,requestId:crypto.randomUUID()}});
      const token=++generationToken;
      pollJob(job.id,token);
    }catch(error){busy=false;updateControls();$('#generation-error').textContent=error.message;messages.push({role:'assistant',text:error.message});renderChat();}
  }).finally(updateControls);
}
async function showCourses() {
  if(!guardDirty()||!await flushed())return;
  try{
    const result=await request('/courses');
    openDialog('Мои программы',`<p class="dialog-note">Программы хранятся в локальной базе SQLite.</p><div class="course-list">${result.courses.map(record=>`<button class="course-list-item" data-action="open-course" data-id="${esc(record.id)}"><strong>${esc(record.title)}</strong><span>Версия ${record.revision} · ${new Date(record.updatedAt).toLocaleString('ru-RU')}</span>${icon('arrow-right')}</button>`).join('')}</div>`);
  }catch(error){toast(error.message);}
}
async function loadCourse(id,token=++generationToken) {
  const wasInitialized=initialized;
  pendingClarification=null;initialized=false;updateControls();
  try {
    const record=await request(`/courses/${id}`);
    if(token!==generationToken)return;
    initialized=true;busy=record.job?.status==='running';tab='program';view='preview';attachments=[];renderAttachments();
    applyRecord(record);
    messages=[{role:'assistant',text:course.isDemo?'Открыт демонстрационный пример. Создайте свою программу или измените этот курс.':'Программа загружена из базы. Можно редактировать её, согласовать каркас или запросить изменения.'}];
    proposalMessage();const summary=runSummary(record.job);if(summary)messages.push({role:'assistant',text:summary});renderChat();
    $('#generation-error').textContent=record.job?.status==='failed'?record.job.error:'';
    if(busy)pollJob(record.job.id,token);
  } catch(error) {
    if(token!==generationToken)return;
    initialized=wasInitialized;
    if(initialized&&busy){busy=false;$('#generation-error').innerHTML='Не удалось открыть другую программу. <button class="text-button" data-action="reload-saved">Восстановить состояние текущего запуска</button>';}
    throw error;
  } finally {if(token===generationToken)updateControls();}
}
async function boot() {
  const token=++generationToken;
  pendingClarification=null;initialized=false;updateControls();
  try{
    const status=await request('/status');
    if(token!==generationToken)return;
    requiresLogin=status.requiresLogin;authenticated=status.authenticated;publicDemo=status.publicDemo;updateControls();
    $('#provider-badge').textContent=status.provider;
    const result=await request('/courses');
    if(token!==generationToken)return;
    const requestedId=new URL(location.href).searchParams.get('course');
    if(requestedId||result.courses.length)await loadCourse(requestedId||result.courses[0].id,token);
    else {
      const record=await request('/courses',{method:'POST',body:{course}});
      if(token!==generationToken)return;
      await loadCourse(record.id,token);
    }
    if(token===generationToken&&!status.configured)$('#generation-error').textContent='Ключ модели не настроен на сервере. Сохранение и ручной редактор доступны.';
  }catch(error){if(token!==generationToken)return;initialized=false;$('#document-canvas').innerHTML='<div class="empty-state"><h3>Программа не открыта</h3><p>Проверьте адрес или откройте список программ.</p></div>';$('#project-title').textContent='Программа не открыта';$('#save-error').hidden=false;$('#save-error').innerHTML=`<p>${esc(error.message)}</p><button class="text-button" data-action="retry-boot">Повторить подключение</button><button class="text-button" data-action="reset-route">Открыть список программ</button>`;$('#session-status').textContent='Нет подключения';updateControls();}
}

document.addEventListener('click',async event=>{
  const tabButton=event.target.closest('[data-tab]');
  if(tabButton&&initialized&&guardDirty()){tab=tabButton.dataset.tab;renderDocument();return;}
  const viewButton=event.target.closest('[data-view]');
  if(viewButton&&initialized&&guardDirty()){view=viewButton.dataset.view;renderDocument();return;}
  const target=event.target.closest('[data-action]');if(!target)return;
  const action=target.dataset.action;
  if(!initialized&&!['retry-boot','reset-route','access'].includes(action))return;
  const mutations=['add-normative-sources','new-course','attach','remove-attachment','confirm-references','sources','add-source','remove-source','check-source','add-topic','remove-topic','add-module','remove-module','add-entry','remove-entry','approve','generate-skeleton','generate-materials','revise-module','accept-proposal','reject-proposal','editor','program-editor','retry-save'];
  if(mutations.includes(action)&&!writable())return showAccess();
  try{
    if(action==='access'){if(authenticated){if(!guardDirty()||!await flushed())return;await request('/session/logout',{method:'POST',body:{}});authenticated=false;dirty=false;view='preview';renderDocument();updateSaveUI();}else showAccess();}
    if(action==='expand'){
      const panel=document.getElementById(target.dataset.panel);const expanded=panel.classList.toggle('expanded');
      target.innerHTML=icon(expanded?'collapse':'expand');target.setAttribute('aria-label',expanded?'Свернуть область':'Развернуть область');
    }
    if(action==='zoom-in'||action==='zoom-out'){zoom=Math.max(70,Math.min(150,zoom+(action==='zoom-in'?10:-10)));shell();if(tab==='slides')renderDocument();}
    if((action==='preview'||action==='editor')&&guardDirty()){view=action==='editor'?'editor':'preview';renderDocument();}
    if(action==='program-editor'&&guardDirty()){tab='program';view='editor';renderDocument();}
    if(action==='cancel-edit'){dirty=false;view='preview';renderDocument();}
    if(action==='add-normative-sources'){const sources=[...$('#source-rows').querySelectorAll('.source-entry')].map(x=>({url:x.querySelector('[name=url]').value}));for(const item of suggestedNormativeSources({...course,sources}))$('#source-rows').insertAdjacentHTML('beforeend',sourceEditor(item));}
    if(action==='new-course'&&guardDirty()&&await flushed())showNewCourse();
    if(action==='courses')await showCourses();
    if(action==='open-course'&&await flushed()){await loadCourse(target.dataset.id);$('#main-dialog').close();}
    if(action==='export'&&guardDirty()&&await flushed())showExport();
    if(action==='proposal'&&guardDirty()&&await flushed())showProposal();
    if(action==='close-dialog')$('#main-dialog').close();
    if(['download-json','download-docx','download-pptx','download-moodle.xml'].includes(action)&&await flushed()){
      const link=document.createElement('a');link.href=`/api/courses/${recordId}/export.${action.replace('download-','')}`;link.download='';link.click();
    }
    if(action==='print'){$('#main-dialog').close();view='preview';renderDocument();window.print();}
    if(action==='attach'&&guardDirty()&&await flushed())$('#reference-input').click();
    if(action==='remove-attachment'&&!busy){changeCourse({references:(course.references || []).filter((_,i)=>i!==Number(target.dataset.index))});renderAttachments();}
    if(action==='view-reference'){const reference=course.references[Number(target.dataset.index)];openDialog(esc(reference.name),`<p class="preserve-lines">${esc(reference.text)}</p>`);}
    if(action==='confirm-references'){changeCourse({references:[...(course.references || []),...attachments]});attachments=[];renderAttachments();$('#main-dialog').close();if(await flushed())toast('Референсы сохранены и будут учтены моделью.');}
    if(action==='sources'&&guardDirty()&&await flushed())showSources();
    if(action==='check-source')await checkSource(target.closest('.source-entry'));
    if(action==='add-source')$('#source-rows').insertAdjacentHTML('beforeend',sourceEditor());
    if(action==='remove-source')target.closest('.source-entry').remove();
    if(action==='add-topic'){target.closest('.module-row').querySelector('.topic-rows').insertAdjacentHTML('beforeend',topicEditor());dirty=true;}
    if(action==='remove-topic'){target.closest('.topic-entry').remove();dirty=true;}
    if(action==='revise-module'&&guardDirty()&&await flushed())openDialog('Обновить один модуль',`<form id="module-revision-form"><label>Модуль<select name="moduleIndex">${course.modules.map((m,i)=>`<option value="${i}">${esc(m.title)}</option>`).join('')}</select></label><label>Что изменить<textarea name="prompt" required maxlength="3000"></textarea></label><p>Будут подготовлены содержание, тесты, задания и слайды выбранного модуля. Остальные модули сохранятся. Изменения применяются только после просмотра и принятия.</p><button class="button primary">Подготовить предложение</button></form>`);
    if(action==='add-module'){$('#module-rows').insertAdjacentHTML('beforeend',moduleRow({title:'',hours:1},$('#module-rows').children.length,newModuleIndex--));dirty=true;$('#module-rows').lastElementChild.querySelector('input').focus();}
    if(action==='remove-module'){const row=target.closest('.module-row');const index=Number(row.dataset.originalIndex);if(['tests','tasks','slides'].some(name=>course[name]?.some(x=>x.moduleIndex===index))){toast('У модуля есть связанные материалы. Сначала уберите их в соответствующих редакторах.');return;}row.remove();dirty=true;}
    if(action==='add-entry'){$('#material-rows').insertAdjacentHTML('beforeend',materialEntry({moduleIndex:0},$('#material-rows').children.length));dirty=true;}
    if(action==='remove-entry'){target.closest('[data-entry]').remove();dirty=true;}
    if(action==='approve'&&guardDirty()&&await flushed()){
      target.disabled=true;applyRecord(await request(`/courses/${recordId}/approve`,{method:'POST',body:{revision:savedVersion}}));toast('Каркас согласован. Можно подготовить материалы.');
    }
    if(action==='generate-skeleton')await startGeneration('skeleton',$('#chat-input').value.trim());
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
document.addEventListener('input',event=>{if(event.target.id==='new-request'){const type=inferProgramType(event.target.value);$('#type-inference').textContent=type ? `Определён тип: ${type}. Можно изменить его вручную.` : 'Тип не определён однозначно. Уточните запрос или выберите тип вручную.';}if(event.target.matches('.source-entry [name=url]')){const entry=event.target.closest('.source-entry');sourceChecks.get(entry)?.invalidate();entry.querySelector('.source-check-result').textContent='Ссылка изменена. Запустите проверку заново.';}if(event.target.closest('#editor-form')){dirty=true;$('#document-status').textContent='Есть несохранённые правки';}});
window.addEventListener('session-expired',()=>{authenticated=false;updateControls();});
document.addEventListener('submit',async event=>{
  if(event.target.id==='access-form'){event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await request('/session',{method:'POST',body:{password:new FormData(event.target).get('password')}});authenticated=true;$('#main-dialog').close();await boot();}catch(error){$('#access-error').textContent=error.message;button.disabled=false;}return;}
  if(!writable()){event.preventDefault();return;}
  if(event.target.id==='editor-form'){
    event.preventDefault();const form=new FormData(event.target);let patch;
    if(tab==='program') {
      const rows=[...document.querySelectorAll('.module-row')];
      const remap=new Map(rows.map((row,i)=>[Number(row.dataset.originalIndex),i]));
      patch={programDetails:Object.fromEntries(Object.keys(detailFields).map(key=>[key,form.get('detail-'+key).trim()])),title:form.get('title').trim(),goal:form.get('goal').trim(),competencies:form.get('competencies').split('\n').map(v=>v.trim()).filter(Boolean),
        competencyMap:[...document.querySelectorAll('.competency-entry')].map(entry=>({competencyIndex:Number(entry.dataset.index),professionalStandard:{...Object.fromEntries(['title','code','functionCode','url','evidence'].map(key=>[key,entry.querySelector(`[name=standard-${key}]`).value.trim()])),status:entry.querySelector('[name=standard-confirmed]').checked?'confirmed':'unverified'},...Object.fromEntries(['knowledge','skills','abilities'].map(key=>[key,entry.querySelector(`[name=${key}]`).value.split('\n').map(x=>x.trim()).filter(Boolean)]))})),
        modules:rows.map(row=>preserveModule(course.modules[Number(row.dataset.originalIndex)] || {},{
          title:row.querySelector('[name=module-title]').value.trim(),hours:Number(row.querySelector('[name=module-hours]').value),content:row.querySelector('[name=module-content]').value.trim(),lecturePlan:row.querySelector('[name=lecturePlan]').value.trim(),
          topics:[...row.querySelectorAll('.topic-entry')].map(entry=>({title:entry.querySelector('[name=topic-title]').value.trim(),...Object.fromEntries(hourFields.map(key=>[key,Number(entry.querySelector(`[name=${key}]`).value)])),competencyIndices:[...entry.querySelector('[name=competencyIndices]').selectedOptions].map(o=>Number(o.value))}))
        }))};
      for(const name of ['tests','tasks','slides'])patch[name]=(course[name] || []).map(item=>({...item,moduleIndex:remap.get(item.moduleIndex) ?? item.moduleIndex}));
    } else patch={[tab]:[...document.querySelectorAll('[data-entry]')].map(entry=>{const item={};for(const field of entry.querySelectorAll('textarea,select'))item[field.name]=field.name==='moduleIndex'?Number(field.value):field.name==='competencyIndices'?[...field.selectedOptions].map(o=>Number(o.value)):field.value.trim();return item;})};
    if(tab==='program'){const count=patch.competencies.length;patch.competencyMap=patch.competencyMap.filter(x=>x.competencyIndex<count);for(const m of patch.modules)for(const topic of m.topics)topic.competencyIndices=topic.competencyIndices.filter(i=>i<count);for(const name of ['tests','tasks','slides'])for(const item of patch[name])item.competencyIndices=(item.competencyIndices || []).filter(i=>i<count);}
    if(Object.values(patch).some(value=>typeof value==='string'&&!value.trim())){$('#editor-error').textContent='Поля не могут состоять только из пробелов.';return;}
    dirty=false;changeCourse(patch);view='preview';renderDocument();
    if(await flushed())toast('Правки сохранены в SQLite. Каркас проверен.');
  }
  if(event.target.id==='clarification-form'){
    event.preventDefault();const patch=Object.fromEntries([...new FormData(event.target)].map(([k,v])=>[k,v.trim()]));
    if(clarificationQuestions({...course,...patch}).length){$('#clarification-error').textContent='Заполните ответы: можно явно указать отсутствие подготовки.';return;}
    const button=event.target.querySelector('[type=submit]');button.disabled=true;
    changeCourse(patch);
    if(await flushed()){
      const pending=pendingClarification;pendingClarification=null;
      $('#main-dialog').close();renderParameters();renderDocument();
      if(pending?.courseId===recordId)await startGeneration(pending.stage,pending.prompt,pending.moduleIndex);
    }else{button.disabled=false;$('#clarification-error').textContent='Ответы пока не сохранены. Восстановите связь с сервером и повторите сохранение.';}
  }
  if(event.target.id==='module-revision-form'){event.preventDefault();const form=new FormData(event.target);$('#main-dialog').close();await startGeneration('module',form.get('prompt').trim(),Number(form.get('moduleIndex')));}
  if(event.target.id==='sources-form'){event.preventDefault();const sources=[...event.target.querySelectorAll('.source-entry')].map(entry=>Object.fromEntries(['title','url','evidence'].map(k=>[k,entry.querySelector(`[name=${k}]`).value.trim()]).concat([['status',entry.querySelector('[name=confirmed]').checked?'confirmed':'unverified']])));if(sources.some(x=>x.status==='confirmed'&&!x.evidence)){$('#sources-error').textContent='Для подтверждения укажите, кто и как проверил источник.';return;}changeCourse({sources});if(await flushed()){$('#main-dialog').close();renderDocument();}}
  if(event.target.id==='new-course-form'){
    event.preventDefault();const form=new FormData(event.target);const button=event.target.querySelector('[type=submit]');button.disabled=true;
    try{
      const draft=createCourse({title:form.get('title').trim(),type:form.get('type'),request:form.get('request'),assessment:form.get('assessment'),hours:Number(form.get('hours')),fresh:true});draft.audience=form.get('audience').trim();draft.level=form.get('level').trim();
      const record=await request('/courses',{method:'POST',body:{course:draft}});$('#main-dialog').close();await loadCourse(record.id);$('#chat-input').value=form.get('request').trim();messages=[{role:'assistant',text:`Выбран тип: ${draft.type}. Запрос перенесён в чат; перед генерацией можно дополнить его.`},{role:'assistant',text:'Программа создана и сохранена. Нажмите «Сформировать каркас» или опишите требования в чате.'}];renderChat();
    }catch(error){$('#new-course-error').textContent=error.message;button.disabled=false;}
  }
});
$('#main-dialog').addEventListener('close',()=>{pendingClarification=null;});
$('#chat-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||generationGuard.active||!guardDirty())return;
  const input=$('#chat-input');const prompt=input.value.trim();
  if(!prompt){$('#chat-error').textContent='Напишите, что нужно изменить.';input.focus();return;}
  messages.push({role:'user',text:prompt});input.value='';renderChat();
  await startGeneration(course.modules.length?'revision':'skeleton',prompt);
});
$('#reference-input').addEventListener('change', async event => {
  const selected=[...event.target.files];event.target.value='';
  if(busy||readingReferences||!selected.length)return;
  const errors=[];attachments=[];readingReferences=true;updateControls();$('#chat-error').textContent='Извлекаю текст референсов…';
  try {
    for(const file of selected) {
      if((course.references?.length || 0)+attachments.length>=10){errors.push('Разрешено до 10 референсов.');break;}
      if(!/\.(pdf|docx|txt)$/i.test(file.name)||file.size>20*1024*1024){errors.push(`${file.name}: нужен TXT/PDF/DOCX до 20 МБ.`);continue;}
      try {
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('Не удалось прочитать файл.'));reader.readAsDataURL(file);});
        attachments.push(await request('/references/extract',{method:'POST',body:{name:file.name,data}}));
      } catch(error){errors.push(`${file.name}: ${error.message}`);}
    }
    if(attachments.length)openDialog('Проверьте извлечённые референсы',`<p class="dialog-note">После подтверждения текст сохранится с программой и будет передан командной модели хакатона при генерации. Оригиналы файлов не сохраняются. Проверьте извлечение, особенно таблицы PDF.</p>${attachments.map(x=>`<details open><summary>${esc(x.name)} · ${x.text.length} знаков</summary><p class="preserve-lines">${esc(x.text)}</p></details>`).join('')}`, '<button class="button" data-action="close-dialog">Отмена</button><button class="button primary" data-action="confirm-references">Подтвердить референсы</button>');
  } finally {readingReferences=false;updateControls();$('#chat-error').textContent=errors.join(' ');}
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
