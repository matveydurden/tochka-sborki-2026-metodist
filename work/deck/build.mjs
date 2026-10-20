import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const root=process.cwd(), build=path.join(root,'work/deck'), out=path.join(root,'outputs');
const SKILL='/Users/matvey/.codex/plugins/cache/openai-primary-runtime/presentations/26.1013.11914/skills/presentations';
process.env.RUNTIME_NODE_MODULES='/Users/matvey/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const PY='/Users/matvey/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const p=Presentation.create({slideSize:{width:1600,height:900}});
const C={bg:'#F5F7F4',ink:'#14241C',muted:'#5F6D64',green:'#168B3F',dark:'#103D29',lime:'#D8F681',line:'#DDE4DD',white:'#FFFFFF',pale:'#E8F3E9'};
const src={case:'https://hub.gigaschool.ru/events/tochka-sborki-2026/cases/sber-edu-agent',pd:'https://www.consultant.ru/document/cons_doc_LAW_61801/',edu:'https://publication.pravo.gov.ru/document/view/0001201212300007',dpo:'https://publication.pravo.gov.ru/document/0001202504230011',general:'http://publication.pravo.gov.ru/Document/View/0001202209270013'};
function box(s,x,y,w,h,fill=C.white,stroke='none',radius=22){return s.shapes.add({geometry:'roundRect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:stroke==='none'?0:1},borderRadius:radius});}
function tx(s,t,x,y,w,h,size=28,color=C.ink,bold=false,align='left'){const sh=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});sh.text=t;sh.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:align,verticalAlignment:'top',insets:0,autoFit:'none',wrap:'square',lineSpacing:1.13};return sh;}
function slide(q,title,sub=''){const s=p.slides.add();s.background.fill=C.bg;const n=p.slides.items.length;tx(s,q?`ВОПРОС ${q}`:'ПРОДУКТОВЫЙ ЧЕКПОИНТ',64,38,1000,26,19,C.green,true);tx(s,title,64,82,1472,70,45,C.ink,true);if(sub)tx(s,sub,64,153,1472,64,25,C.muted);tx(s,'Методист / Пхукетская',64,860,800,24,17,C.muted);tx(s,String(n).padStart(2,'0')+' / 09',1430,860,106,24,17,C.muted,false,'right');return s;}
function note(s,t){s.speakerNotes.text=t;}
function link(s,label,url,x,y,w){const a=tx(s,label,x,y,w,24,17,C.green);a.text=[{run:label,link:{uri:url,isExternal:true}}];}
async function img(s,file,x,y,w,h){const b=await fs.readFile(path.join(out,file));s.images.add({blob:b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),contentType:'image/png',fit:'contain',position:{left:x,top:y,width:w,height:h},alt:'Концептуальный интерфейс приложения Методист, созданный ImageGen'});}
// 01
{
const s=p.slides.add();s.background.fill=C.bg;
tx(s,'КОМАНДА «ПХУКЕТСКАЯ»',72,54,900,42,31,C.ink,true);
tx(s,'Матвей Мусиенко — капитан\nЗахар Толошный — участник',1010,49,520,78,24,C.muted,false,'right');
box(s,64,180,1472,560,C.dark);
tx(s,'Продуктовый хакатон «Точка сборки»',112,226,1376,50,29,C.lime,false,'center');
tx(s,'Методист',112,327,1376,126,112,C.white,true,'center');
tx(s,'ИИ-помощник для подготовки\nобразовательных программ',190,480,1220,116,41,C.white,false,'center');
tx(s,'От запроса методиста до согласованного комплекта курса',150,650,1300,44,27,'#D9E9DF',false,'center');
tx(s,'Кейс АЦР и GigaCowork',72,788,1000,32,24,C.muted);tx(s,'Продуктовая концепция / 15 октября 2026',860,788,668,32,24,C.muted,false,'right');
note(s,'Команда: Матвей Мусиенко и Захар Толошный. Концепция для кейса № 1. Источник: '+src.case);
}
// 02
{
const s=slide('1','Задача бизнеса и наш пользователь','Сократить ручную подготовку образовательной программы и повторные согласования.');
box(s,64,250,470,340,C.dark);tx(s,'2–8 недель',96,286,410,100,70,C.white,true);tx(s,'занимает подготовка\nодной программы сейчас',96,408,400,95,30,C.white);tx(s,'По данным кейсодателя АЦР',96,540,400,30,20,'#D9E9DF');
box(s,558,250,978,340);tx(s,'Основной пользователь — методист АЦР',592,282,900,58,34,C.ink,true);tx(s,'Задаёт аудиторию и требования, собирает программу по шаблону и согласует результат. Не обязан быть экспертом в каждом ИТ-направлении.',592,365,890,134,29);tx(s,'Преподаватель проверяет содержание. Руководитель утверждает программу.',592,515,890,64,25,C.muted);
const xs=[64,564,1064];const titles=['Часы расходятся','Материалы противоречат','Компетенции не проверяются'];const bodies=['Ручные расчёты возвращают программу на доработку.','Программа, тесты и слайды создаются в разных файлах.','Нет явной связи между результатами обучения и заданиями.'];
xs.forEach((x,i)=>{box(s,x,620,472,190);tx(s,titles[i],x+25,645,420,64,28,C.ink,true);tx(s,bodies[i],x+25,716,420,80,24,C.muted);});link(s,'Источник: описание кейса АЦР',src.case,72,821,700);note(s,'Источник исходного срока и проблем: '+src.case);
}
// 03
{
const s=slide('2','Требования и ограничения','Сохраняем контроль методиста и учитываем требования кейса и законодательства РФ.');
const cards=[['Программы и входные данные','Два шаблона АЦР: повышение квалификации и общеразвивающая программа. ИТ-направления, 16–500 часов. Референсы: DOCX, PDF и текст.'],['Полный комплект материалов','Компетенции, учебные планы, тесты с ключами, задания с критериями, планы лекций и слайды. Выгрузка DOCX, PPTX и JSON.'],['Инфраструктура и контроль','Cloud.ru Evolution Foundation Models, единый API. Структуру согласует человек. ИИ показывает пакет правок до применения.'],['Качество и достоверность','Автопроверка часов, разделов и покрытия компетенций. Включаем только подтверждённые источники. Реквизиты утверждения не заполняем.']];
cards.forEach((a,i)=>{let x=64+(i%2)*748,y=242+Math.floor(i/2)*205;box(s,x,y,724,182);tx(s,a[0],x+26,y+22,670,42,29,C.ink,true);tx(s,a[1],x+26,y+75,670,95,24,C.muted);});
box(s,64,668,1472,157,C.pale);tx(s,'Нормативная основа',90,687,1400,38,27,C.green,true);tx(s,'273-ФЗ «Об образовании», приказ № 266 для ДПО и № 629 для общеразвивающих программ.\n152-ФЗ «О персональных данных»: минимизация данных, законные основания обработки, ограничение доступа и защита. В учебных примерах используем обезличенные данные.',90,731,1410,82,23);
link(s,'152-ФЗ',src.pd,88,831,110);link(s,'273-ФЗ',src.edu,220,831,110);link(s,'Приказ № 266',src.dpo,352,831,180);link(s,'Приказ № 629',src.general,554,831,180);note(s,'Нормативные источники: '+JSON.stringify(src)+'. Приказ № 266 от 24.03.2025 заменил № 499 с 01.09.2025. Это проектные требования, не заявление о пройденной правовой сертификации.');
}
//04
{
const s=slide('3','Основной сценарий','Методист согласует структуру целиком, затем получает материалы сразу для всего курса.');
const steps=[['01','Материалы','Загружаем файлы. ИИ извлекает параметры и их источники.'],['02','Уточнения','Отвечаем на недостающие вопросы и подтверждаем данные.'],['03','Структура','Видим цель, компетенции и часы. Согласуем каркас целиком.'],['04','Комплект','Получаем материалы всех модулей и результат автопроверки.'],['05','Правки и экспорт','Подтверждаем пакет правок. Проверяем и скачиваем комплект.']];
steps.forEach((a,i)=>{const x=64+i*299;box(s,x,262,277,346);tx(s,a[0],x+24,285,230,58,42,C.green,true);tx(s,a[1],x+24,365,230,48,27,C.ink,true);tx(s,a[2],x+24,430,230,160,24,C.muted);});
box(s,64,647,1472,170,C.dark);tx(s,'Пример запроса',94,671,1390,36,25,C.lime,true);tx(s,'«Анализ данных на Python» для сотрудников банка. 72 часа, четыре недели,\nочно-заочно. Входной уровень — Excel. Итоговая аттестация — защита проекта.',94,721,1380,78,29,C.white);note(s,'Сценарий согласован командой в CONCEPT.md. Пример основан на открытом запросе № 3 кейса АЦР.');
}
//05
{
const s=slide('3','Рабочее пространство методиста','Заполненный прототип: курс «Анализ данных на Python», 72 часа.');
await img(s,'interface-main.png',55,218,1120,625);
const rows=[['½ экрана','Материалы','Просмотр файла и вкладки материалов. Редактирование вручную.'],['¼ экрана','Параметры','Часы, аудитория, формат и аттестация всегда перед глазами.'],['¼ экрана','Диалог с ИИ','Вопросы и запросы на правки. Любая область разворачивается на весь экран.']];
rows.forEach((a,i)=>{const y=235+i*201;tx(s,a[0],1210,y,300,34,24,C.green,true);tx(s,a[1],1210,y+41,310,40,26,C.ink,true);tx(s,a[2],1210,y+90,310,105,22,C.muted);});note(s,'Прототип, созданный встроенным ImageGen. Интерфейс не реализован. Все данные демонстрационные.');
}
//06
{
const s=slide('3','Материалы доступны в предпросмотре','Пример слайда того же курса. Изменения применяются только после подтверждения.');
await img(s,'interface-changes.png',55,215,1120,630);
const arr=[['Запрос','Добавить практику по SQL и сохранить общий объём 72 часа.'],['Предложение','План, тесты, задания и слайды меняются одним пакетом. Общий объём сохраняется.'],['Подтверждение','Методист принимает пакет целиком. Затем запускается автоматическая проверка.']];
arr.forEach((a,i)=>{const y=240+i*194;tx(s,a[0],1210,y,300,42,28,C.green,true);tx(s,a[1],1210,y+55,310,133,25);});note(s,'Концептуальный сценарий точечной переработки. Сумма часов после предложенной замены остаётся 72. Макет создан ImageGen.');
}
//07
{
const s=slide('4','Экономическая ценность','Цель — ускорить подготовку курса и сократить объём ручной сборки и исправлений.');
box(s,64,248,470,380,C.dark);tx(s,'от 7 раз',96,293,410,99,77,C.white,true);tx(s,'быстрее по сроку\nподготовки курса',96,416,410,90,33,C.white);tx(s,'Целевая гипотеза для пилота',96,568,410,40,23,C.lime);
box(s,558,248,978,174);tx(s,'Сейчас: 2–8 недель',590,273,900,47,37,C.ink,true);tx(s,'Ручная сборка файлов, сверка часов и повторные согласования. Срок указан в описании кейса.',590,338,890,68,26,C.muted);
box(s,558,446,978,182,C.pale);tx(s,'Цель: 1–2 дня на готовый курс',590,470,900,47,37,C.green,true);tx(s,'До 20 минут на генерацию комплекта на 72 часа. Затем экспертная проверка и небольшие адресные правки.',590,535,890,76,26);
box(s,64,660,1472,160);tx(s,'Проверяем экономику на реальной работе методиста',94,681,1380,42,29,C.ink,true);tx(s,'Консервативный расчёт срока: 14 календарных дней / 2 дня = 7.\nЭкономию затрат считаем отдельно: сэкономленные часы × ставка специалиста − стоимость генерации.',94,737,1370,71,26,C.muted);
note(s,'Базовый срок 2–8 недель: '+src.case+'. 1–2 дня и ускорение минимум в 7 раз — целевая гипотеза команды, не результат испытаний. Сравнивается календарный цикл, не трудозатраты. Требуемая генерация полного комплекта 72 часа ≤20 минут.');
}
//08
{
const s=slide('5','Успех — пригодный первый результат','Первый комплект должен требовать небольших правок, а не переписывания каждой темы или слайда.');
const rows=[['Экономическая эффективность','Цель: курс за 1–2 дня, ускорение срока от 7 раз.','Измеряем весь цикл, часы специалистов и стоимость ИИ.'],['Пригодность первой итерации','Ориентир пилота: ≥90% материалов без существенной переработки.','Эксперт отмечает пригодные блоки, задания и слайды.'],['Объём ручных исправлений','Небольшие адресные правки без полной пересборки курса.','Считаем долю исправленных материалов и время правок.'],['Согласованность и достоверность','0 ошибок в часах. Все результаты покрыты. Источники подтверждены.','Проверяем арифметику, связи и чек-листы кейса.'],['Скорость генерации','Каркас ≤3 минут. Комплект на 72 часа ≤20 минут.','Замеряем новый запрос от запуска до готового результата.']];
rows.forEach((a,i)=>{let y=245+i*109;box(s,64,y,1472,96,i%2?C.pale:C.white);tx(s,a[0],86,y+19,345,69,26,C.ink,true);tx(s,a[1],460,y+16,600,75,25);tx(s,a[2],1100,y+17,410,74,22,C.muted);});
tx(s,'Все показатели — цели. Проверка на пяти открытых запросах и новых примерах; результат принимает эксперт.',72,809,1450,34,22,C.muted);note(s,'Метрики пригодности и 90% — первоначальные цели пилота команды, не измеренные результаты. Пригодность означает содержательную оценку экспертом, а не отказ от экспертной проверки. Ограничения скорости взяты из '+src.case);
}
//09
{
const s=p.slides.add();s.background.fill=C.dark;tx(s,'МЕТОДИСТ',80,60,1400,45,27,C.lime,true);tx(s,'Полный комплект курса\nпод контролем методиста',80,220,1440,190,66,C.white,true);tx(s,'Согласованная структура. Связанные материалы.\nАвтоматическая проверка и подтверждение изменений человеком.',84,467,1370,120,32,'#D9E9DF');tx(s,'Спасибо за внимание',84,666,1370,70,48,C.white,true);tx(s,'Команда «Пхукетская»\nМатвей Мусиенко и Захар Толошный',84,773,1050,80,25,C.lime);tx(s,'Концепция / 2026',1190,805,325,32,22,'#D9E9DF',false,'right');note(s,'Продуктовая концепция для хакатона Точка сборки. Работающий сервис и измеренная эффективность пока отсутствуют.');
}
await fs.mkdir(path.join(build,'renders'),{recursive:true});

for(let i=0;i<p.slides.items.length;i++){const png=await p.export({slide:p.slides.items[i],format:'png',scale:2});await fs.writeFile(path.join(build,`renders/slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));}
if(process.env.RENDER_ONLY==='1'){console.log('Rendered nine slides');process.exit(0);}
const cand=path.join(build,'candidate.pptx');await (await PresentationFile.exportPptx(p)).save(cand);
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir:root,candidatePath:cand,finalPath:path.join(out,'Metodist-product-brief.pptx'),pythonExecutable:PY,integrityValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','15240000,8572500','--validate-bullet-geometry','--validate-heading-fit'],explicitTotalSlideCount:9,fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation.json')});

console.log(JSON.stringify({slides:p.slides.items.length,finalizer:result}));
