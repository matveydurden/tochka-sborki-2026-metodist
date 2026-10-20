import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const root=process.cwd(), build=path.join(root,'work/deck-airy'), out=path.join(root,'outputs');
const SKILL='/Users/matvey/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
process.env.RUNTIME_NODE_MODULES='/Users/matvey/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const PY='/Users/matvey/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const p=Presentation.create({slideSize:{width:1600,height:900}});
const C={bg:'#FFFFFF',ink:'#14241C',muted:'#5F6D64',green:'#00A944',dark:'#21A038',lime:'#D4FF72',line:'#DDE4DD',white:'#FFFFFF',pale:'#EEFAF1'};
const src={case:'https://hub.gigaschool.ru/events/tochka-sborki-2026/cases/sber-edu-agent',pd:'https://www.consultant.ru/document/cons_doc_LAW_61801/',edu:'https://publication.pravo.gov.ru/document/view/0001201212300007',dpo:'https://publication.pravo.gov.ru/document/0001202504230011',general:'http://publication.pravo.gov.ru/Document/View/0001202209270013'};
function box(s,x,y,w,h,fill=C.white,stroke='none',radius=22){return s.shapes.add({geometry:'roundRect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:stroke==='none'?0:1},borderRadius:radius});}
function tx(s,t,x,y,w,h,size=28,color=C.ink,bold=false,align='left'){const sh=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});sh.text=t;sh.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:align,verticalAlignment:'top',insets:0,autoFit:'none',wrap:'square',lineSpacing:1.13};return sh;}
function slide(q,title,sub=''){const s=p.slides.add();s.background.fill='#21A038';box(s,24,24,1552,852,C.white,'none',30);const n=p.slides.items.length;tx(s,q?`ВОПРОС ${q}`:'ПРОДУКТОВЫЙ ЧЕКПОИНТ',64,38,1000,26,19,C.green,true);tx(s,title,72,88,1456,80,48,C.ink,true);if(sub)tx(s,sub,72,174,1456,60,26,C.muted);tx(s,'Методист / Пхукетская',64,848,800,24,17,C.muted);tx(s,String(n).padStart(2,'0')+' / 08',1430,848,106,24,17,C.muted,false,'right');return s;}
function note(s,t){s.speakerNotes.text=t;}
function link(s,label,url,x,y,w){const a=tx(s,label,x,y,w,24,17,C.green);a.text=[{run:label,link:{uri:url,isExternal:true}}];}
async function img(s,file,x,y,w,h){const b=await fs.readFile(path.join(out,file));s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',fit:'contain',position:{left:x,top:y,width:w,height:h},alt:'Концептуальный интерфейс приложения Методист, созданный ImageGen'});}
// 1: cover
{
const s=p.slides.add();s.background.fill='#21A038';box(s,24,24,1552,852,C.white,'none',30);
tx(s,'КОМАНДА «ПХУКЕТСКАЯ»',80,66,800,44,29,C.green,true);
tx(s,'Матвей Мусиенко — капитан\nЗахар Толошный — участник',1000,62,510,80,24,C.muted,false,'right');
tx(s,'Продуктовый хакатон «Точка сборки»',110,268,1380,46,28,C.green,false,'center');
tx(s,'Методист',110,365,1380,145,115,C.ink,false,'center');
tx(s,'Программа курса и учебные материалы\nв одном рабочем пространстве',180,550,1240,112,39,C.ink,false,'center');
tx(s,'Кейс АЦР и GigaCowork',80,796,900,34,23,C.muted);tx(s,'Концепция / 15.10.2026',1040,796,470,34,23,C.muted,false,'right');note(s,'Команда Пхукетская. Концепция, работающий сервис ещё не реализован. '+src.case);
}
// 2: question 1
{
const s=slide('1','Задача бизнеса и пользователь');
box(s,80,245,550,390,C.pale);tx(s,'2–8',115,282,480,140,110,C.green);tx(s,'недель на подготовку\nодной программы',118,454,470,100,38);tx(s,'По данным АЦР',118,584,450,30,22,C.muted);
const people=[['Методист','Собирает программу, часы и материалы'],['Эксперт','Проверяет содержание и результаты обучения'],['Руководитель','Утверждает программу']];people.forEach((r,i)=>{const y=252+i*137;tx(s,r[0],730,y,750,45,33,C.green);tx(s,r[1],730,y+54,750,68,29);});
tx(s,'Проблема: ошибки в часах, разрозненные файлы и повторные согласования.',84,727,1420,74,29,C.muted);link(s,'Источник: кейс АЦР',src.case,84,817,650);note(s,'Основной пользователь — методист АЦР. Он знает требования к образовательной программе, но не обязан глубоко разбираться в каждом ИТ-направлении. Материалы готовят разные специалисты, поэтому часы расходятся, темы повторяются, а компетенции не всегда проверяются. Исходный срок 2–8 недель приведён кейсодателем: '+src.case);
}
// 3: question 2
{
const s=slide('2','Требования кейса и законодательства');
tx(s,'Полный комплект',84,240,670,48,34,C.green);tx(s,'Два шаблона АЦР, программы 16–500 часов\nРеференсы: DOCX, PDF и текст\nКомпетенции, планы, тесты, задания и слайды\nЭкспорт: DOCX, PPTX и JSON',84,317,690,225,29);
tx(s,'Контроль качества',850,240,650,48,34,C.green);tx(s,'Cloud.ru, без зарубежных API моделей\nСтруктура и правки — с подтверждением\nАвтопроверка часов и связей материалов\nТолько подтверждённые источники',850,317,650,225,29);
box(s,80,628,1440,162,C.pale);tx(s,'273-ФЗ и приказы № 266 / № 629',109,650,1350,44,30,C.ink,true);tx(s,'152-ФЗ: минимизация персональных данных, ограничение доступа и защита.\nУчебные примеры — на обезличенных данных.',109,711,1350,69,26,C.muted);
link(s,'152-ФЗ',src.pd,88,817,110);link(s,'273-ФЗ',src.edu,220,817,110);link(s,'Приказ № 266',src.dpo,352,817,180);link(s,'Приказ № 629',src.general,554,817,180);
note(s,'Поддерживаем повышение квалификации, включая стажировки, и общеразвивающие программы. Методист утверждает цель, компетенции и часы до генерации содержания. Карта компетенций связана с темами, вопросами и заданиями. Тесты имеют ключи, задания — критерии. Слайды готовим для лекций курса. Модели и эмбеддинги из Cloud.ru Evolution Foundation Models, проверка через единый API. Реквизиты приказов, ФИО и подписи не заполняем. Учитываем законные основания обработки данных по 152-ФЗ; проектные требования не означают пройденную сертификацию. '+JSON.stringify(src));
}
// 4: question 3 scenario
{
const s=slide('3','Как работает «Методист»');
const steps=[['01','Задать курс','Загрузить файлы и уточнить\nнедостающие параметры'],['02','Согласовать структуру','Цель, компетенции, темы\nи распределение часов'],['03','Получить весь комплект','Программа, тесты, задания,\nлекции и слайды с автопроверкой'],['04','Внести правки и выгрузить','Самостоятельно или через ИИ.\nСвязанные изменения — одним пакетом']];
steps.forEach((r,i)=>{let x=84+(i%2)*760,y=265+Math.floor(i/2)*245;tx(s,r[0],x,y,95,62,45,C.green);tx(s,r[1],x+130,y,590,65,33);tx(s,r[2],x+130,y+85,590,98,28,C.muted);});
tx(s,'Пример: анализ данных на Python для сотрудников банка, 72 часа',89,798,1400,42,26,C.green);note(s,'Первый экран — массовая загрузка материалов. Извлечённые ответы подтверждаются, опросник спрашивает только недостающее. Каркас виден целиком. После согласования готовится комплект для всего курса. Методист редактирует материалы вручную или в диалоге. ИИ показывает основную правку и зависимые изменения одним пакетом до применения. После генерации и каждой сохранённой или принятой правки проверка запускается автоматически.');
}
// 5: question 3 workspace
{
const s=slide('3','Рабочее пространство методиста');
await img(s,'interface-main.png',200,163,1200,660);
tx(s,'Концепт интерфейса / заполненный курс на 72 часа',80,823,1440,30,21,C.muted,false,'center');note(s,'Макет ImageGen. Слева половина экрана с предпросмотром документа, вкладками материалов, ручным редактированием и режимом структурированного редактора. Справа сверху параметры программы, снизу диалог с ИИ. Каждая область разворачивается на весь экран. Это концепция интерфейса, а не работающий сервис.');
}
// 6: question 4 economics
{
const s=slide('4','Меньше времени на подготовку курса');
box(s,80,247,530,420,C.pale);tx(s,'от 7×',117,296,455,135,102,C.green);tx(s,'цель ускорения\nподготовки курса',120,480,440,105,35);
tx(s,'Сейчас',730,256,740,42,27,C.muted);tx(s,'2–8 недель',730,310,740,78,60,C.ink);tx(s,'Цель с сервисом',730,464,740,42,27,C.muted);tx(s,'1–2 дня',730,517,740,78,60,C.green);tx(s,'До 20 минут на генерацию,\nзатем проверка и адресные правки',730,616,740,84,29,C.muted);
tx(s,'Гипотеза: 14 календарных дней / 2 дня = 7. Экономию затрат измерим в пилоте.',84,786,1430,62,25,C.muted);note(s,'Срок 2–8 недель из кейса АЦР. Цель команды — полный цикл за 1–2 дня. Минимальное ускорение 7 раз рассчитано по календарному сроку, не по затратам. Реальных замеров пока нет. Экономика: сэкономленные часы специалистов × ставка − стоимость генерации. Для методиста это меньше ручной сборки и сверки; для АЦР — более быстрый запуск программ. '+src.case);
}
// 7: question 5 metrics
{
const s=slide('5','Готовность первой итерации к работе');
const rows=[['≥90%','материалов без существенной переработки'],['0','расхождений в часах и непроверенных источников'],['≤3 / ≤20 мин','каркас / комплект курса на 72 часа'],['1–2 дня','полный цикл подготовки с проверкой человеком']];
rows.forEach((r,i)=>{const y=245+i*126;tx(s,r[0],88,y,470,85,i===2?49:60,C.green);tx(s,r[1],620,y+12,855,82,32);});
tx(s,'Пилот: доля исправлений, время методиста, стоимость ИИ.\nВсе значения — цели, а не результаты испытаний.',90,783,1400,68,25,C.muted);note(s,'Пригодность означает небольшие адресные правки после проверки экспертом, а не переписывание каждой темы и каждого слайда. Ориентир >=90% материалов без существенной переработки проверяет эксперт. Часы, связи результатов обучения и оценочных средств и полнота шаблонов проверяются по открытым чек-листам и новым запросам. Каждому результату обучения соответствует тема и не менее двух оценочных средств. Считаем трудозатраты, долю исправленных материалов и токены, включая повторную генерацию. Ограничения скорости взяты из кейса.');
}
// 8 close
{
const s=p.slides.add();s.background.fill='#21A038';
tx(s,'Методист',85,92,1430,125,86,C.white);tx(s,'Комплект курса,\nготовый к экспертной проверке',85,308,1430,185,64,C.white);
tx(s,'Спасибо за внимание',89,622,1420,75,47,C.white);tx(s,'Команда «Пхукетская»\nМатвей Мусиенко и Захар Толошный',89,754,1360,80,26,C.white);note(s,'Концепция. Цель — полный комплект с минимальными правками и контролем методиста.');
}
await fs.mkdir(path.join(build,'renders'),{recursive:true});
for(let i=0;i<p.slides.items.length;i++){await fs.writeFile(path.join(build,`renders/slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await(await p.export({slide:p.slides.items[i],format:'png',scale:2})).arrayBuffer()));}
const cand=path.join(build,'candidate.pptx');await(await PresentationFile.exportPptx(p)).save(cand);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({workspaceDir:root,candidatePath:cand,finalPath:path.join(out,'Metodist-checkpoint.pptx'),pythonExecutable:PY,integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-heading-fit'],explicitTotalSlideCount:8,fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation-checkpoint.json')});
console.log('8 slides finalized');
