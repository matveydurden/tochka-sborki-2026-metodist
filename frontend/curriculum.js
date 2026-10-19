export const hourFields = ['lectureHours','practiceHours','labHours','selfStudyHours','assessmentHours'];
export const hourLabels = ['Лекции','Практика','Лабораторные','Самостоятельная работа','Аттестация'];
export function curriculumChecks(course) {
  const modules=course.modules || [], outcomes=course.competencies || [];
  const mapped=new Set((course.competencyMap || []).filter(x=>['knowledge','skills','abilities'].every(k=>x[k]?.length)).map(x=>x.competencyIndex));
  const taught=new Set(modules.flatMap(m=>(m.topics || []).flatMap(t=>t.competencyIndices || [])));
  const tested=new Set((course.tests || []).flatMap(t=>t.competencyIndices || []));
  const practised=new Set((course.tasks || []).flatMap(t=>t.competencyIndices || []));
  return {
    topicHours:{valid:modules.length>0 && modules.every(m=>m.topics?.length && m.topics.reduce((sum,t)=>sum+hourFields.reduce((n,k)=>n+Number(t[k] || 0),0),0)===m.hours)},
    competencyMap:{valid:outcomes.length>0 && outcomes.every((_,i)=>mapped.has(i)&&taught.has(i))},
    coverage:{valid:outcomes.length>0 && outcomes.every((_,i)=>mapped.has(i)&&taught.has(i)&&tested.has(i)&&practised.has(i))},
    lecturePlans:{valid:modules.length>0 && modules.every(m=>m.topics?.length && (!m.topics.some(t=>t.lectureHours>0)||m.lecturePlan?.trim()))},
    sources:{valid:Boolean(course.sources?.length) && course.sources.every(s=>s.status==='confirmed'&&s.evidence?.trim())},
  };
}
export function preserveModule(original,patch) { return {...original,...patch}; }

export function skeletonIdentity(course) {
  return {...Object.fromEntries(['title','goal','competencies','competencyMap','references','audience','level','hours','type','format','assessment'].map(k=>[k,course[k]])),modules:course.modules.map(m=>({title:m.title,hours:m.hours,topics:m.topics}))};
}
