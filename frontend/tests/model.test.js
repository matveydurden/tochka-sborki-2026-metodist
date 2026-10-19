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
