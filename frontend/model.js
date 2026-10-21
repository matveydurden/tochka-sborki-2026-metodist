import {curriculumChecks,skeletonIdentity} from './curriculum.js';
import {inferProgramType,normativeChecks,programDetailsChecks} from './programs.js';
export function createCourse(options = {}) {
  const fresh = options.fresh;
  const selectedType=options.type || (options.request!==undefined ? inferProgramType(options.request) : 'Повышение квалификации');
  if(!selectedType)throw new Error('Выберите тип программы: в запросе нет однозначного указания. Уточните, нужна ли общеразвивающая программа, повышение квалификации или стажировка.');
  return {
    references: [], sources: [], competencyMap: [], revision: 0, approved: false, isDemo: !fresh, competencies: fresh ? [] : ['Обрабатывать таблицы с помощью Python и SQL'], tests: [], tasks: [], slides: [], title: options.title || 'Анализ данных на Python',
    type: selectedType, hours: options.hours || 72,
    audience: fresh ? '' : 'Сотрудники банка', level: fresh ? 'не задан' : 'Excel', format: 'Очно-заочно', duration: fresh ? '' : '4 недели', group: 20,
    assessment: 'Защита проекта',
    goal: fresh ? '' : 'Анализировать обезличенные банковские данные с помощью Python и SQL.',
    modules: fresh ? [] : [
      { title: 'Основы Python', hours: 10 }, { title: 'Обработка данных в pandas', hours: 20 },
      { title: 'Работа с SQL', hours: 12 }, { title: 'Визуализация данных', hours: 10 },
      { title: 'Основы статистики', hours: 12 }, { title: 'Проект и аттестация', hours: 8 },
    ],
    question: fresh ? '' : 'Какой метод pandas позволяет объединить две таблицы по общему столбцу?',
    answer: fresh ? '' : 'merge()',
    task: fresh ? '' : 'Исследуйте обезличенный набор банковских операций: очистите данные, рассчитайте показатели и представьте выводы на трёх графиках.',
    slide: { title: fresh ? '' : 'От данных — к решениям', body: fresh ? '' : 'Загрузка данных · Очистка пропусков · Группировка и агрегация · Визуализация результатов' },
  };
}
export function validate(course) {
  const total = course.modules.reduce((sum, module) => sum + Number(module.hours), 0);
  const positive = course.modules.length > 0 && course.modules.every(module => Number.isFinite(module.hours) && module.hours > 0 && module.title.trim());
  const structureDetails=[['goal','цель программы'],['modules','модули'],['competencies','результаты обучения']].filter(([key])=>!course[key]?.length).map(([,label])=>`Заполните ${label}.`);
  const materialDetails=course.materialsStale ? ['Каркас изменён: сохранённые материалы требуют обновления.'] : [];
  if(!course.modules.length)materialDetails.push('Добавьте модули программы.');
  course.modules.forEach((m,i)=>{const absent=[...(!m.content?.trim()?['учебный текст']:[]),...['tests','tasks','slides'].filter(k=>!course[k]?.some(x=>x.moduleIndex===i)).map(k=>({tests:'тесты',tasks:'задания',slides:'слайды'})[k])];if(absent.length)materialDetails.push(`Модуль ${i+1} «${m.title}»: добавьте ${absent.join(', ')}.`);});
  return {
    hours: { valid: positive && Number.isInteger(course.hours) && course.hours >= 16 && course.hours <= 500 && total === course.hours, total, details:[`Часы модулей / объём программы: ${total} / ${course.hours} ч.`] },
    structure: { valid: Boolean(course.title.trim() && course.goal.trim() && course.modules.length && course.competencies?.length),details:structureDetails },
    materials: { valid: !course.materialsStale && course.modules.length > 0 && course.modules.every((module,index) => module.content?.trim() && ['tests','tasks','slides'].every(name => course[name]?.some(item => item.moduleIndex === index))),details:materialDetails },
    ...curriculumChecks(course), ...normativeChecks(course), ...programDetailsChecks(course),
  };
}
export function updateCourse(course, patch) {
  const changed={ ...course, ...patch, revision: course.revision + 1 };
  changed.approved=course.approved && JSON.stringify(skeletonIdentity(course))===JSON.stringify(skeletonIdentity(changed));
  return changed;
}

export function clarificationQuestions(course) {
  return [
    {field:'audience',question:'Для кого предназначена программа? Укажите должность, возраст или задачи слушателей.'},
    {field:'level',question:'Что слушатели уже знают и умеют? Если подготовки нет, укажите «Без опыта».'},
    {field:'duration',question:'За какой срок нужно пройти обучение: дни, недели или месяцы?'},
  ].filter(({field})=>!course[field]?.trim() || ['не задан','не задано','не указано'].includes(course[field].trim().toLowerCase()));
}

export function proposalWarnings(course,stage) {
  const titles={programSections:'Полнота разделов программы',professionalStandards:'Профстандарты и трудовые функции',materialCounts:'Количество оценочных материалов и слайдов',hours:'Сумма часов',structure:'Полнота каркаса',materials:'Связанные материалы',topicHours:'Часы тем',competencyMap:'Карта компетенций',coverage:'Покрытие результатов',lecturePlans:'Планы лекций',contentDepth:'Объём учебного текста',sources:'Источники',normativeBasis:'Нормативные основания'};
  const skeletonKeys=['hours','structure','topicHours','competencyMap'];
  return Object.entries(validate(course)).filter(([key,value])=>!value.valid && (stage!=='skeleton'||skeletonKeys.includes(key))).map(([key,value])=>({key,title:titles[key] || key,details:value.details || []}));
}
