export const hourFields = ['lectureHours','practiceHours','labHours','selfStudyHours','assessmentHours'];
export const hourLabels = ['Лекции','Практика','Лабораторные','Самостоятельная работа','Аттестация'];
export function curriculumChecks(course) {
  const modules=course.modules || [], outcomes=course.competencies || [];
  const mapped=new Set((course.competencyMap || []).filter(x=>['knowledge','skills','abilities'].every(k=>x[k]?.length)).map(x=>x.competencyIndex));
  const taught=new Set(modules.flatMap(m=>(m.topics || []).flatMap(t=>t.competencyIndices || [])));
  const coverageDetails=[];
  modules.forEach((m,mi)=>{
    const local=new Set((m.topics || []).flatMap(t=>t.competencyIndices || []));
    for(const i of local){
      const absent=[['tests','тест'],['tasks','задание']].filter(([key])=>!(course[key] || []).some(x=>x.moduleIndex===mi&&x.competencyIndices?.includes(i))).map(([,name])=>name);
      if(absent.length)coverageDetails.push(`Модуль ${mi+1} «${m.title}», РО-${i+1}: добавьте ${absent.join(' и ')} со связью с результатом.`);
    }
  });
  outcomes.forEach((_,i)=>{if(!mapped.has(i)||!taught.has(i))coverageDetails.push(`РО-${i+1}: не заполнена карта или нет темы.`);});
  const topicDetails=modules.flatMap((m,i)=>{
    const total=(m.topics || []).reduce((n,t)=>n+hourFields.reduce((v,k)=>v+Number(t[k] || 0),0),0);
    return !m.topics?.length || total!==m.hours ? [`Модуль ${i+1} «${m.title}»: темы — ${total} ч, модуль — ${m.hours} ч. Распределите часы тем.`] : [];
  });
  const mapDetails=outcomes.flatMap((_,i)=>[...(!mapped.has(i)?[`РО-${i+1}: заполните знания, умения и навыки.`]:[]),...(!taught.has(i)?[`РО-${i+1}: укажите раскрывающую его тему.`]:[])]);
  const lectureDetails=modules.flatMap((m,i)=>!m.topics?.length || (m.topics.some(t=>t.lectureHours>0)&&!m.lecturePlan?.trim()) ? [`Модуль ${i+1} «${m.title}»: добавьте темы и план лекции.`] : []);
  const sourceDetails=course.sources?.length ? course.sources.filter(s=>s.status!=='confirmed'||!s.evidence?.trim()).map(s=>`НЕ ПОДТВЕРЖДЁН: ${s.title}. Проверьте первоисточник и укажите свидетельство проверки.`) : ['Добавьте источники и сведения об их проверке.'];
  const countDetails=modules.flatMap((m,i)=>[['tests','тестов',3,20],['tasks','заданий',1,10],['slides','слайдов',4,8]].flatMap(([key,label,min,max])=>{const count=(course[key] || []).filter(x=>x.moduleIndex===i).length;return count<min||count>max ? [`Модуль ${i+1} «${m.title}»: ${label} — ${count}, ориентир ${min}–${max}.`] : [];}));
  const depthDetails=modules.flatMap((m,i)=>{const words=(m.content?.trim() || '').split(/\s+/).filter(Boolean).length;return words<600 ? [`Модуль ${i+1} «${m.title}»: ${words} слов; ориентир учебного текста — не менее 600 слов. Это проверка объёма, предметное качество оценивает эксперт.`] : [];});
  return {
    materialCounts:{valid:modules.length>0 && !countDetails.length,details:countDetails},
    contentDepth:{valid:modules.length>0 && !depthDetails.length,details:depthDetails},
    topicHours:{valid:modules.length>0 && modules.every(m=>m.topics?.length && m.topics.reduce((sum,t)=>sum+hourFields.reduce((n,k)=>n+Number(t[k] || 0),0),0)===m.hours),details:topicDetails},
    competencyMap:{valid:outcomes.length>0 && outcomes.every((_,i)=>mapped.has(i)&&taught.has(i)),details:mapDetails},
    coverage:{valid:outcomes.length>0 && !coverageDetails.length,details:coverageDetails},
    lecturePlans:{valid:modules.length>0 && modules.every(m=>m.topics?.length && (!m.topics.some(t=>t.lectureHours>0)||m.lecturePlan?.trim())),details:lectureDetails},
    sources:{valid:Boolean(course.sources?.length) && course.sources.every(s=>s.status==='confirmed'&&s.evidence?.trim()),details:sourceDetails},
  };
}
export function preserveModule(original,patch) { return {...original,...patch}; }

export function skeletonIdentity(course) {
  return {...Object.fromEntries(['title','goal','competencies','competencyMap','references','audience','level','hours','duration','type','format','assessment'].map(k=>[k,course[k]])),modules:course.modules.map(m=>({title:m.title,hours:m.hours,topics:m.topics}))};
}
