import catalog from './assets/program-profiles.json' with {type:'json'};

export function programProfile(course) { return catalog.profiles[course.type]; }
export function inferProgramType(request) {
  const text=String(request || '').toLowerCase().replaceAll('ё','е');
  // Explicit negation or alternatives need a human decision; hours alone are insufficient.
  if (/(?:^|[\s,;.!?])(?:не|без|кроме)\s+[^.!?;]{0,60}(?:стажиров|квалификац|общеразвива)/u.test(text)) return null;
  const general=/общеразвивающ/u.test(text);
  const professional=/повышени[ея]\s+квалификаци|дополнительн[^.!?;]{0,25}профессиональн|(?:^|[^а-я])дпп(?:$|[^а-я])/u.test(text);
  const internship=/стажировк/u.test(text);
  if (general && (professional || internship)) return null;
  if (internship && professional && /(?:или|либо)/u.test(text)) return null;
  if (/(?:стажировк|квалификаци|общеразвива)[^.!?;]{0,40}\sне\s/u.test(text)) return null;
  if (internship) return 'Стажировка';
  if (general) return 'Общеразвивающая';
  if (professional) return 'Повышение квалификации';
  return null;
}
function canonicalUrl(value) {
  try {
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['','80','443'].includes(url.port))return null;
    return url.hostname.toLowerCase()+url.pathname.toLowerCase().replace(/\/$/u,'');
  } catch {return null;}
}
function identifiesDocument(title,key) {
 const pattern=key==='law273' ? /273[\s-]*фз/iu : new RegExp('приказ[^\n]{0,100}(?<!\\d)'+(key==='order266'?'266':'629')+'(?!\\d)','iu');
 return pattern.test(title || '');
}
export function normativeEntries(course) {
  return programProfile(course).documents.map(key=>{
    const item=catalog.documents[key];
    const source=(course.sources || []).find(x=>identifiesDocument(x.title,key)&&canonicalUrl(x.url)===canonicalUrl(item.url)&&x.status==='confirmed'&&x.evidence?.trim());
    return {...item,status:source?'confirmed':'unverified',evidence:source?.evidence || 'Применимость и редакцию не подтвердил методист.'};
  });
}
export function normativeChecks(course) {
  const details=normativeEntries(course).filter(x=>x.status!=='confirmed').map(x=>`НЕ ПОДТВЕРЖДЁН: ${x.title}. Проверьте редакцию и применимость, добавьте официальный URL и сведения о проверке в источники: ${x.url}`);
  return {normativeBasis:{valid:details.length===0,details}};
}
export function suggestedNormativeSources(course) {
  return programProfile(course).documents.map(key=>({...catalog.documents[key],status:'unverified',evidence:''})).filter(x=>!(course.sources || []).some(y=>canonicalUrl(x.url)===canonicalUrl(y.url)));
}
export const catalogDate=catalog.checkedAt;

export const detailFields={admissionRequirements:'Требования к поступающим',completionDocument:'Документ по итогам обучения',calendarSchedule:'Календарный график',learningConditions:'Условия обучения',normativeNotes:'Обоснование применимости нормативных документов'};
export function programDetailsChecks(course) {
 const sections=Object.entries(detailFields).filter(([key])=>!course.programDetails?.[key]?.trim()).map(([,label])=>`${label}: не заполнено.`);
 const standards=programProfile(course).id==='professional' ? (course.competencies.length ? course.competencies.flatMap((_,i)=>course.competencyMap?.find(x=>x.competencyIndex===i)?.professionalStandard?.status==='confirmed'?[]:[`РО-${i+1}: профстандарт и трудовая функция не подтверждены методистом.`]):['Сначала определите результаты обучения и их связь с профстандартом.']) : [];
 return {programSections:{valid:!sections.length,details:sections},professionalStandards:{valid:!standards.length,details:standards}};
}
