import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourse,validate,updateCourse} from '../model.js';

test('несовпадающие часы не проходят проверку каркаса',()=>{
  const state=createCourse();state.hours=80;
  assert.equal(validate(state).hours.valid,false);
});
test('ручная правка снимает согласование и сохраняет исходный объект',()=>{
  const state=createCourse();state.approved=true;
  const changed=updateCourse(state,{hours:80});
  assert.equal(changed.approved,false);
  assert.equal(changed.revision,state.revision+1);
  assert.equal(state.hours,72);
});
test('нулевые часы модуля и отсутствующие результаты блокируют проверку',()=>{
  const state=createCourse();state.modules[0].hours=0;
  assert.equal(validate(state).hours.valid,false);
  state.competencies=[];
  assert.equal(validate(state).structure.valid,false);
});
test('новый курс не получает модули и материалы демонстрационного примера',()=>{
  const state=createCourse({title:'Веб-разработка',hours:16,fresh:true});
  assert.equal(state.modules.length,0);
  assert.equal(state.goal,'');assert.equal(state.task,'');
  assert.equal(state.isDemo,false);
  assert.equal(validate(state).hours.valid,false);
});
test('проверка материалов обнаруживает пустой, частичный и устаревший комплект',()=>{
  const state=createCourse({fresh:true});
  assert.equal(validate(state).materials.valid,false);
  state.modules=[{title:'Основы',hours:16,content:'Объяснение'}];
  state.tests=[{moduleIndex:0,question:'Вопрос',answer:'Ответ'}];
  state.tasks=[{moduleIndex:0,text:'Задание',criteria:'Критерий'}];
  assert.equal(validate(state).materials.valid,false);
  state.slides=[{moduleIndex:0,title:'Слайд',body:'Текст'}];
  assert.equal(validate(state).materials.valid,true);
  state.materialsStale=true;
  assert.equal(validate(state).materials.valid,false);
});

test('редактирование модуля сохраняет темы и план лекции',async()=>{
  const {preserveModule}=await import('../curriculum.js');
  const module={title:'Основы',hours:16,topics:[{title:'Тема'}],lecturePlan:'План'};
  const changed=preserveModule(module,{content:'Ручной текст'});
  assert.deepEqual(changed.topics,module.topics);assert.equal(changed.lecturePlan,'План');
});

test('правка материала сохраняет согласование каркаса',()=>{
  const state=createCourse();state.approved=true;
  const changed=updateCourse(state,{tests:[{moduleIndex:0,question:'Правка',answer:'Ключ'}]});
  assert.equal(changed.approved,true);
});

test('покрытие результата проверяется отдельно в каждом модуле',()=>{
  const state=createCourse({fresh:true});state.competencies=['Результат'];
  state.competencyMap=[{competencyIndex:0,knowledge:['Знания'],skills:['Умения'],abilities:['Навыки']}];
  state.modules=[0,1].map(i=>({title:`Модуль ${i+1}`,hours:8,topics:[{title:'Тема',lectureHours:8,competencyIndices:[0]}]}));
  state.tests=[{moduleIndex:0,competencyIndices:[0]}];state.tasks=[0,1].map(moduleIndex=>({moduleIndex,competencyIndices:[0]}));
  assert.equal(validate(state).coverage.valid,false);
  assert.ok(validate(state).coverage.details.some(x=>x.includes('Модуль 2')&&x.includes('РО-1')));
});

test('уточнение перечисляет все недостающие ответы, а заполненный запрос пропускает',async()=>{
  const {clarificationQuestions}=await import('../model.js');
  const state=createCourse({fresh:true});state.audience=' ';state.level='не задан';state.duration='';
  assert.deepEqual(clarificationQuestions(state).map(x=>x.field),['audience','level','duration']);
  Object.assign(state,{audience:'Аналитики',level:'Без опыта',duration:'2 недели'});
  assert.deepEqual(clarificationQuestions(state),[]);
});

test('срок нового курса уточняется у методиста и не подставляется из демо',()=>{
  assert.equal(createCourse({fresh:true}).duration,'');
});

test('изменение срока снимает согласование программы',()=>{
  const state=createCourse();state.approved=true;
  assert.equal(updateCourse(state,{duration:'8 недель'}).approved,false);
});

test('перед применением материалов видны краткий текст и неподтверждённые источники',async()=>{
  const {proposalWarnings}=await import('../model.js');
  const state=createCourse({fresh:true});Object.assign(state,{goal:'Цель',competencies:['Результат'],competencyMap:[{competencyIndex:0,knowledge:['Знания'],skills:['Умения'],abilities:['Навыки']}],hours:16});
  state.modules=[{title:'Модуль',hours:16,content:'Краткий текст',lecturePlan:'План',topics:[{title:'Тема',lectureHours:16,competencyIndices:[0]}]}];
  state.tests=[{moduleIndex:0,competencyIndices:[0]}];state.tasks=[{moduleIndex:0,competencyIndices:[0]}];state.slides=[{moduleIndex:0}];
  const warnings=proposalWarnings(state,'materials');
  assert.ok(warnings.some(x=>x.key==='contentDepth'&&x.details.some(x=>x.includes('Модуль 1'))));
  assert.ok(warnings.some(x=>x.key==='sources'));
  assert.deepEqual(proposalWarnings(state,'skeleton'),[]);
});
