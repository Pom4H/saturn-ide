# Типизированные отчёты и XLSX

## Один authored report, несколько выходных форматов

`report()` теперь принимает два варианта плана: существующие временные агрегаты
`column(signal, aggregate, label)` и SQL с `schema`, типизированными `signals` и
выходными колонками. Это варианты одного элемента `project.reports`, одного
BuildArtifact и одного runtime API. Schema/workbook — обычные сериализуемые поля
того же отчёта. Отдельного реестра отчётов или второго файла модели нет.

Готовый проектный пример: `examples/reports/flow.ts`. Его можно скопировать в
`reports/` своего проекта и добавить `flowReport(booster.flow)` в `project.reports`.
Он компилируется настоящим language service и Builder в browser acceptance test.

## Перенос с 90da21a

| Старый контракт | Текущий контракт |
| --- | --- |
| reportField, numberField, booleanField, textField, dateTimeField | Экспортируются из `@saturn/core`; используются существующие Signal и SignalValue |
| reportSchema, reportColumn | Вывод ключей/типов строки; неизвестная колонка — ошибка TypeScript; результат SQL проверяется runtime |
| excelColumn, asc, desc, excelSheet, workbook | Листы, порядок колонок, сортировка, числовые/временные форматы, ширина, freezeRows, autoFilter |
| title | `label`, включая RU/EN |
| on.workflow_dispatch.inputs | `inputs` с default/min/max; UI и Workflow SDK передают проверенные значения |
| on.schedule UTC + window | `schedule: [{cron, timeZone: 'UTC', periodMs: window}]`; поддержка IANA timezone уже существует |
| signals: старые refs → строки | Обычные ссылки на Signal, восстановленные decoder из BuildArtifact |
| samples / segments | Изолированная SQLite-капсула из одного согласованного снимка runtime history |
| summary / chart | Числовые summary, line/bar, пропуски, типизированные поля; HTML/печать и preview |
| report task + revision | Durable snapshot + hash, artifactId, build identity, inputs, runId, actor, trigger |

В базовом `90da21a` найдены Excel-спецификации и их проверки, но не найден XLSX
renderer. Здесь добавлен настоящий OOXML ZIP renderer. Тестовый XLSX независимо
прочитан openpyxl; это не CSV с переименованным расширением.

Осознанное отличие `dateTimeField`: строка результата имеет канонический ISO UTC
тип, согласованный с JSON-передачей и сохранением. SQL принимает epoch milliseconds
или timestamp с явным timezone. Excel получает числовую дату с date format.
Булевы 0/1 из SQLite нормализуются в boolean. Numeric-looking strings остаются
строками. Missing SQL alias — ошибка даже при нуле строк; NULL — допустимый пропуск.

Это перенос **XLSX и typed report schema**, не заявление о полной визуальной
паритетности старой presentation-системы. Старый произвольный `Presentation/view`
с общим HMI-деревом и report notification/outbox ещё не восстановлен; критерии
паритета по ним остаются открыты. PDF-файл не генерируется: сохранён браузерный
print target. Нет придуманного firmware/XLSX результата.

## Исполнение и воспроизводимость

1. Runtime проверяет диапазон и inputs и читает все сигналы в одной транзакции
   (PostgreSQL REPEATABLE READ, SQLite transaction snapshot).
2. Предшествующая точка нужна для временного hold; samples содержит точки внутри
   `[from,to)`. Segments покрывает окно каждого сигнала, включая явные missing/stale
   интервалы. Значения вне good не интегрируются. SQL сам определяет агрегацию.
3. Исходные definition, inputs и samples сохраняются в `report_snapshots` под
   SHA-256 до расчёта. Это аудитные данные runtime, не authored source.
4. SQL работает только с samples/segments в отдельном Bun-процессе. SELECT,
   bound named parameters, query_only, trusted_schema off, heap limit 128 MiB,
   5-секундное принудительное завершение. Операционная БД в процесс не передаётся.
5. Готовый результат сохраняется в `report_artifacts`. CSV, XLSX и HTML читают
   сохранённые строки и форматирование; повторное скачивание не запускает SQL.
   ZIP timestamps фиксированы: повторный XLSX идентичен побайтно.
6. Workers используют этот же runtime-путь. Job identity предотвращает повторное
   исполнение завершённого задания. Сайт повторно проверяет checks.read/runtime.read
   и передаёт скачивание через сервер, без worker token в браузере.

У window два применения: рекомендуемый ручной период SQL-отчёта и явное значение
при формировании расписания. Запрошенный пользователем from/to имеет приоритет.
Build identity обозначает версию **определения** отчёта; обычный report не фильтрует
архив по версии приобретения наблюдения. Для A/B существует отдельный compare API.

## Форматы и ограничения

- API: `/api/report?id=…&from=…&to=…&inputs=<JSON>` возвращает JSON с artifactId.
- Экспорт: `/api/report?artifact=…&format=xlsx|csv|html&locale=ru|en`.
- Runtime-only host предоставляет те же операции за runtime credentials.
- Worker: `/api/report-artifact?project=…&job=…&format=xlsx|csv|html` — только для
  успешно завершённого report job соответствующего проекта и с worker credentials.
- В IDE доступны ручные inputs, CSV/XLSX/HTML, print, summary/chart/table, ошибки.
- SQL: 31 день, до 64 signals, 50 000 observations на сигнал / 200 000 всего,
  2 000 строк / 1 MB результата. Агрегатные отчёты сохраняют лимит 1 000 buckets.
- XLSX: до 16 листов / 64 колонок, строки до 32 767 символов; даты с 1900 года.
  Null — пустая ячейка, ноль — число 0; boolean — boolean; текст всегда inlineStr,
  никогда formula. При сортировке null идёт в конец в обоих направлениях.
- Форматы/сортировки относятся к листам XLSX. Summary/chart относятся к HTML/print;
  native Excel charts не были частью найденного старого workbook-контракта.
- HTML экранируется и имеет CSP; preview в sandboxed iframe без scripts.
- Снимки и результаты не удаляются при pruning сырых measurements. Автоматическая
  политика удаления report artifacts не добавлена.

## Проверки

`tests/report-schema-types.ts` проверяется обоими TypeScript-компиляторами.
`tests/report-migration.test.ts` переносит старый вектор 17.5 / 80%, проверяет типы,
SQL isolation, NULL, timestamps, Excel, сохранение snapshot и kill timeout.
`scripts/report-browser-test.ts` проверяет настоящий проект/браузер/скачивание.
`scripts/report-worker-test.ts` проверяет настоящий Bun Worker и restart.
`scripts/workflow-worker-test.ts` дополнительно проверяет XLSX через собранный
Nitro + Workflow SDK + authenticated gateway. Точные результаты — в verification.md.
