import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourse,validate} from '../model.js';

test('тип программы определяется из явного запроса методиста',()=>{
  for(const [request,type] of [
    ['Повышение квалификации на 72 часа по Python','Повышение квалификации'],
    ['Дополнительная общеразвивающая программа по ИИ','Общеразвивающая'],
    ['Стажировка по системному анализу на 248 часов','Стажировка'],
    ['ДПП повышения квалификации в форме стажировки','Стажировка'],
  ]) assert.equal(createCourse({fresh:true,request}).type,type);
});
test('неоднозначность, отрицание и конфликт требуют ручного выбора',()=>{
  for(const request of ['Повышение квалификации или стажировка','Повышение квалификации, стажировка не нужна','Курс Python на 72 часа','Это не стажировка','Повышение квалификации или общеразвивающая программа','Не нужна общеразвивающая программа, требуется повышение квалификации'])
    assert.throws(()=>createCourse({fresh:true,request}),/Выберите тип программы/);
});
test('явный выбор методиста имеет приоритет над автоматическим определением',()=>{
  assert.equal(createCourse({fresh:true,request:'Общеразвивающая программа',type:'Повышение квалификации'}).type,'Повышение квалификации');
});
test('интерфейс не считает обычную литературу нормативным основанием',()=>{
  const course=createCourse({fresh:true,type:'Общеразвивающая'});
  course.sources=[{title:'273-ФЗ и приказ629',url:'https://example.org/fake',status:'confirmed',evidence:'Проверено'}];
  const report=validate(course);
  assert.ok(report.normativeBasis);
  assert.equal(report.normativeBasis.valid,false);
  assert.ok(report.normativeBasis.details.some(x=>x.includes('629')));
});
test('старые программы явно показывают итоговые пробелы, общий профиль не требует профстандарт',()=>{
 const course=createCourse({fresh:true,type:'Общеразвивающая'});
 assert.equal(validate(course).programSections.valid,false);
 assert.equal(validate(course).professionalStandards.valid,true);
 course.type='Стажировка';
 assert.equal(validate(course).professionalStandards.valid,false);
});
test('заполнение итоговых полей сохраняет согласование учебного каркаса',async()=>{
 const {updateCourse}=await import('../model.js');
 const course=createCourse();course.approved=true;course.competencyMap=[{competencyIndex:0,knowledge:['Типы'],skills:['Читать'],abilities:['Проверять']}];
 const changed=updateCourse(course,{programDetails:{calendarSchedule:'Неделя 1'},competencyMap:[{...course.competencyMap[0],professionalStandard:{title:'Заполняется позже',status:'unverified'}}]});
 assert.equal(changed.approved,true);
});
test('нормативное подтверждение требует идентификатора и конкретного официального URL',async()=>{
 const {normativeEntries,suggestedNormativeSources}=await import('../programs.js');
 const course=createCourse({type:'Повышение квалификации'});
 course.sources=suggestedNormativeSources(course).map(x=>({...x,status:'confirmed',evidence:'Методист сверил редакцию и применимость'}));
 assert.ok(normativeEntries(course).every(x=>x.status==='confirmed'));
 course.sources[1].title='Учебник';
 assert.equal(normativeEntries(course)[1].status,'unverified');
});
