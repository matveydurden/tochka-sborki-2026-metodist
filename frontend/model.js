export function createCourse(options = {}) {
  const fresh = options.fresh;
  return {
    revision: 0, approved: false, isDemo: !fresh, competencies: fresh ? [] : ['Обрабатывать таблицы с помощью Python и SQL'], tests: [], tasks: [], slides: [], title: options.title || 'Анализ данных на Python',
    type: options.type || 'Повышение квалификации', hours: options.hours || 72,
    audience: fresh ? '' : 'Сотрудники банка', level: fresh ? 'не задан' : 'Excel', format: 'Очно-заочно', duration: '4 недели', group: 20,
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
  return {
    hours: { valid: positive && Number.isInteger(course.hours) && course.hours >= 16 && course.hours <= 500 && total === course.hours, total },
    structure: { valid: Boolean(course.title.trim() && course.goal.trim() && course.modules.length && course.competencies?.length) },
    sources: { valid: false },
  };
}
export function updateCourse(course, patch) {
  return { ...course, ...patch, revision: course.revision + 1, approved: false };
}
