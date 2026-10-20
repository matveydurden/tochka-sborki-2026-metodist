# История Gitea и переноса на GitHub

Срез на 20.10.2026. Источник — API командной [Gitea](https://git.hub.gigaschool.ru/tochka-sborki-2026-team-109/project).

## Что сохранено

- Все 6 коммитов Gitea с исходными SHA, авторами, датами и родительскими связями. Ветка GitHub `codex/archive-gitea-main` указывает на исходный `68dda3f3288760e39ad35b8ad8be09afcdab1d31`.
- Все 11 коммитов локальной разработки и прежнего GitHub. Истории объединены merge-коммитами без rebase, squash и force push.
- На момент переноса в Gitea: 1 ветка (`main`), 0 тегов, 0 pull request’ов во всех состояниях, 0 issues. В прежнем GitHub также 0 PR. Исторических обсуждений PR для импорта нет.
- Доступная лента Gitea: создание репозитория и 5 событий push. Оригинальные даты событий сохранены ниже и в [JSON](archive/gitea-events.json). Исторические события нельзя выдать за новые события GitHub: вкладка Activity в GitHub начинается со времени переноса.
- Код локальной ветки совпал с Gitea по всем общим файлам. Локально дополнительно есть продуктовая документация DOCX; она сохранена. merge с Gitea объединяет происхождение историй без замены актуальных файлов.

## События исходного сервера

| Время GMT+5 | Событие | Коммит |
| --- | --- | --- |
| 2026-10-17 09:10:57 | create_repo | — |
| 2026-10-19 23:34:28 | commit_repo | [`7f6f99f`](https://github.com/matveydurden/tochka-sborki-2026-metodist/commit/7f6f99f373fcdb3692a3054638a8d562876ee64e) |
| 2026-10-19 23:42:54 | commit_repo | [`8e3c4dd`](https://github.com/matveydurden/tochka-sborki-2026-metodist/commit/8e3c4dd340edce6164f2c8ab13fb22e92e2b269e) |
| 2026-10-19 23:49:04 | commit_repo | [`d5253c3`](https://github.com/matveydurden/tochka-sborki-2026-metodist/commit/d5253c32af0301fbda2199607020ce96e752008a) |
| 2026-10-20 13:26:33 | commit_repo | [`72730e8`](https://github.com/matveydurden/tochka-sborki-2026-metodist/commit/72730e8d63ef7a200554ee37fecf34efd5507238) |
| 2026-10-20 13:32:34 | commit_repo | [`68dda3f`](https://github.com/matveydurden/tochka-sborki-2026-metodist/commit/68dda3f3288760e39ad35b8ad8be09afcdab1d31) |

## Границы переноса

Gitea остаётся источником сдачи кода организаторам. GitHub — полная копия истории и рабочая площадка разработчика. Новые изменения GitHub сами не попадают в Gitea или на VM. Сервер, база курсов и конфигурация доступа этим переносом не изменяются.

В Git не включены `.env`, пароли, API-ключи, база SQLite, виртуальные окружения, логи и временные результаты локальных проверок. В `outputs/` сохранены материалы команды, в `work/` — исходники их сборки; скрипты сборки презентации содержат исторические локальные пути и могут потребовать адаптации.
