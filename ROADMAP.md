# Saturn roadmap

Обновлено: **2026-09-25**, по архитектурному аудиту и уточнению `// = не удалено, лежит на полу редактора`.

## Foundation freeze

Архитектуру сохраняем. Новые surfaces, протоколы, native mobile и VS Code не расширяем до закрытия эталонной вертикали. Ни SaaS, ни учебник не становятся вторым источником инженерной истины. Industrial production пока **NO-GO**.

Предыдущий подробный план Mobile / Cloud / Agent сохранён без потери текста в [отложенном плане расширения](ROADMAP.expansion.md). Его прежние формулировки ближайшего приоритета уступают этому freeze. Статусы работ ведутся здесь, а не в копии плана.

## Текущая работа

| Задача | Реализация и критерий закрытия |
|---|---|
| FND-1 — общий authoring и комментарии DSL | Реализовано в `fix/foundation-shared-authoring`: `AuthoringFrame`, TypeScript AST, `Documents`, `LayoutEditing`, `SourceEditing`, общий Editor/Language Service. `//` исключает сущность из active Project, оставляя производное представление на полу; удаление убирает её. Нужен зелёный браузерный round-trip и интеграция в main. |
| FND-2 — независимые концы соединений | В той же ветке трубы и кабели используют Attached / Free на каждом конце. `free(...)` сохраняет координаты в исходнике. Старые `unplugged/looseEnd` принимаются только на границе DSL и нормализуются. Артефакт `saturn.build@3`; старый артефакт требует пересборки. |
| FND-3 — проверяемая платформа | PostgreSQL 18 добавлен в основной job, 201 тест прошёл без пропусков на ревизии `2bf645a`. Физический browser gate ещё красный: 3D создаётся, но кадровый цикл останавливается после двух кадров. Не закрывать по одному typecheck. |
| FND-4 — identity выпуска | Открыто. Заменить выборочный `coreHash` независимым content-addressed ReleaseManifest: artifact/runtime bundle/lock/package/toolchain/schema. Проверка реальных байтов до импорта runtime. Тесты изменения каждого компонента и отказа запуска. Отражение artifact.coreHash обратно в host не является доказательством identity. |
| FND-5 — lifecycle команды | Открыто. Durable commandId, actor, installation, applied revision, requested/dispatched/accepted/observed-confirmed/rejected/timeout; observation и transport acceptance различимы. Audit/correlation переживают restart; неоднозначная команда не повторяется автоматически. |
| FND-6 — защита main | Открыто. Required CI checks, запрет force/delete. Нельзя выдавать branch convention за серверную защиту GitHub. Текущая интеграция не предоставляет administration write. |
| FND-7 — golden path | Открыто, сценарий ниже. Автоматизация не заменяет независимый инженерный handoff. |

В SaaS ветка `fix/shared-authoring-foundation` удаляет учебный regex/parser/особую геометрию. Обучение использует публичные импорты настоящего Shell и 2D/3D. Произвольный пользовательский TS исполняется только в ограниченном opaque-origin worker без I/O. Ошибка черновика сохраняет последнюю корректную сцену и блокирует действия. Уроки владеют объяснениями и целями, а не моделью или обратным редактированием.

## Приёмочный сценарий

`source edit / visual drag → check → semantic diff + impact → publish → apply в отдельный runtime → команда → подтверждающее observation → alarm → history → restart → восстановление applied revision → диагностика → исправление → новый apply`.

Тот же объект открыть оператором без editor authority. Проверить серверный отказ source/publish/apply по operator-токену, сохранение автономной работы при закрытии IDE и отказ применения ошибочного черновика. Передать проект другому инженеру: найти подготовленную неисправность по модели, истории и semantic links без устного объяснения автора. CI фиксирует машинную часть, человек отдельно подтверждает handoff.

## После freeze

Укрепить exhaustiveness semantic signatures и покрытия инженерно значимых изменений; вынести стандартное оборудование в обычный source kit без privileged renderer path. App остаётся composition root, feature state — в headless моделях. Не вводить второй IR, центральный plugin registry, multi-tenant runtime DB или distributed HA ради этого этапа.

Каждый пункт закрывается только кодом, результатом проверки конкретной ревизии и фактическим состоянием main. Наличие тестового файла или запущенного CI не означает завершённую проверку.
