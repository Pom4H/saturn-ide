# Текстовые решения в общем Shell

## Использование

Откройте нижнюю панель **Терминал → Текст**. Напишите, например,
«Покажи насос P-01 в коде», «Покажи показания выбранного насоса» или
«Проверь ошибки в project.ts». Enter подготавливает предложение, Shift Enter
добавляет строку. Точная команда, project, mode, applied revision и класс действия
показываются перед отдельной кнопкой **Подтвердить выполнение**.

Модель выбирает из существующего `commandCatalog`; аргументы и доступные ресурсы
поступают из настоящего `CommandShell.complete`. Это не чат-генератор и не новый
набор tools с собственной моделью оборудования. Результат исполняет тот же
`CommandShell`, привязанный к текущей браузерной `ShellSession`. Командный режим
и внешний CLI продолжают работать без модели. Исходники, selection и журнал не
копируются в отдельный агентный workspace.

При неоднозначности доступны выбор варианта и ввод точного ID/пути/значения.
Показывается не более 100 кандидатов; отсутствующий среди них объект можно найти
по точному ID. Неизвестные сущности и значения вне диапазона не превращаются в команды.
Числовые writable-значения берутся из числовых литералов запроса либо явного ввода;
модель не выбирает min/max/initial вместо отсутствующего параметра. Перевод единиц
и вычисление чисел не выполняются. Например, «тридцать герц» может потребовать ввода `30`.

Все действия сейчас требуют явного подтверждения, включая навигацию и чтение.
Генерация кода, произвольная перестройка схемы, publish/apply, длительные автономные
цепочки и речь в этой реализации не добавлены. Для coding agents остаётся отдельный
внешний ACP-путь. Этот адаптер решений не заменяет agent harness и не закрывает
полный сценарий COL/AGT/FIELD из roadmap.

## Локальная модель

Запустите именно **Kev System One server**, а не OpenAI-compatible chat endpoint
обычной Qwen-модели. Уже работающий совместимый сервер повторно устанавливать не нужно.
Пример из README Kev:

```sh
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009
```

В `.env` каталога запуска Saturn IDE:

```dotenv
SATURN_DECISION_PROVIDER=kev
# При нестандартном адресе:
# SATURN_DECISION_URL=http://127.0.0.1:8009/v1/systemone
# SATURN_DECISION_MODEL=kev-latest
SATURN_DECISION_TIMEOUT_MS=60000
```

Затем `bun dev`. Loopback относится к **машине, где запущен Saturn host**.
Открытие IDE с телефона не направляет запрос к localhost телефона. Если Saturn
и модель находятся на разных машинах, укажите доступный host-машине HTTPS endpoint.

## TypeSafe Jev

```dotenv
SATURN_DECISION_PROVIDER=typesafe
TYPESAFE_API_KEY=your-key
```

Preset: `https://api.typesafe.ai/v1/systemone`, модель `jev-latest`.

## Vercel AI Gateway

```dotenv
SATURN_DECISION_PROVIDER=vercel
AI_GATEWAY_API_KEY=your-key
```

Используется **TypeSafe-compatible путь** Vercel:
`https://ai-gateway.vercel.sh/typesafe/v1/systemone`. Он сохраняет TypeSafe request /
response shape и позволяет использовать тот же транспорт, что локальный Kev.
Модель `jev-latest` соответствует TypeSafe-compatible настройке; конкретный
поддерживаемый alias можно переопределить `SATURN_DECISION_MODEL`.

Это не native `/v1/evaluate`, где Vercel документирует `typesafe-ai/jev` и тип
`boolean` вместо TypeSafe `noul`, и не `/v1/chat/completions`.
Библиотека AI SDK не требуется для одного HTTP-вызова. Saturn не подменяет
провайдера при ошибке и не отправляет локальные данные в облако автоматически.

## Другой совместимый сервер

```dotenv
SATURN_DECISION_PROVIDER=custom
SATURN_DECISION_URL=https://model.example/v1/systemone
SATURN_DECISION_MODEL=my-decision-model
# SATURN_DECISION_API_KEY=your-key
```

Передавайте полный endpoint, включая `/v1/systemone`. Явный
`SATURN_DECISION_API_KEY` имеет приоритет над provider-specific ключом.
HTTP разрешён только на loopback; удалённое соединение требует HTTPS.
URL credentials, query, fragment и redirects запрещены. Ошибка настройки
отключает только этот адаптер, а не IDE или runtime. После изменения `.env`
перезапустите host. Параметры подключения доступны в раскрываемом блоке UI;
форма не сохраняет секреты в браузере.

## Контракт и устойчивость

`src/core/decision.ts` содержит ограниченный System One choice-контракт.
`src/host/decision-api.ts` — необязательный транспорт; он не вызывает runtime
и не исполняет исходники. Его POST endpoint использует существующие same-origin
и `X-Saturn-Key` проверки host. URL, model и bearer credential выбирает host,
не модель и не тело браузерного запроса.

`src/shell/model/decisions.ts` владеет только жизненным циклом предложения:

```
request → choose command → bind arguments → clarify / preview
        → explicit confirmation → existing CommandShell → observed result
```

Зависимые вопросы выполняются последовательно: выбор порта/значения не может
полагаться на ответ другого вопроса того же параллельного запроса.
Проверяются тип ответа, точный набор option IDs, конечность чисел, диапазон
вероятностей, сумма распределения и принадлежность выбранного максимума.
Неизвестный ответ не доходит до диспетчера.

Порог выбранной вероятности 0.7 и отрыв 0.15 определяют лишь необходимость
уточнения. Это стартовые UX-настройки, не измеренная точность на русских
командах Saturn, не полномочия и не доказательство промышленной безопасности.
Подтверждение остаётся необходимым при любой уверенности модели.

Версия ввода, catalog/workspace, runtime revision/mode/phase/connection,
selection/surface и текущий dirty draft проверяются локально. Изменение
контекста отменяет предложение; ответ старого запроса отбрасывается даже
после неуспешной сетевой отмены. План истекает через 60 секунд. Подтверждение
поглощает его до первого await, поэтому двойной клик не дублирует команду.
`CommandShell` повторяет guard перед HTTP-вызовом и после асинхронного открытия
файла перед сохранением. Host сверяет предоставленный `expectedApplied` для
command/ack внутри очереди с apply, включая симулятор.

Нет автоматического retry исполнения. Отмена inference не выполняет действие.
Отмена ожидания уже отправленной команды **не доказывает её отмену**. Успешная
отправка не меняет readback: только последующее наблюдение подтверждает результат.
Для `runtime set` текстовый путь дополнительно требует свежего good-quality
показания. Это guard UX, а не замена блокировкам PLC и авторизации runtime.
Save сохраняет source; автоматический preview доверенного симулятора зависит
от настройки host. Из него не следует разрешение на live apply.

Внешние side effects не получают exactly-once гарантию через HTTP. Нет durable
журнала предложений, cross-client дедупликации, универсального undo физических
эффектов или полноценных прав SaaS в локальном dev host. Контекст моделей не
следует использовать как источник полномочий.

## Какие данные уходят модели

Текст запроса, ограниченный `CommandShell.context()`, описания команд,
идентификаторы/имена/пути ресурсов и портов, типы, единицы и текущие показания.
Полный исходник, driver payload, runtime session key и provider API key не
попадают в этот контекст. Dirty source сравнивается локально. Сам пользователь
может вставить чувствительные данные в запрос: не делайте этого для удалённого
API без разрешения. Провайдер может вести собственный журнал запросов.

Один HTTP-запрос ограничен 128 KiB, ответ 64 KiB, timeout 0.5–120 секунд,
одновременно на host допускаются два inference-запроса. Ошибки провайдера
санитизируются; его внутренний response body не показывается пользователю.

## Проверки

`tests/decision-api.test.ts` проверяет совместимый wire shape, секреты, лимиты,
невалидные ответы, отмену, timeout, shutdown и отсутствие retry/fallback.
`tests/decisions.test.ts` проверяет общий browser session, подтверждение, double
submit, конфликты selection/source/revision, stale observations и точные значения.
`bun scripts/decision-browser-test.ts` использует реальный host и Chromium с
детерминированным System One test server; сохраняет desktop/mobile кадры в
`artifacts/decision`. Он включён в основной CI.

Наличие тестов не означает, что они уже прошли. Результат конкретного запуска
следует проверять в GitHub Actions. Test server проверяет интеграцию, а не качество
понимания русского языка живой моделью. Для живого Jev/Gateway нужны credentials,
для Kev — доступ к реально работающему серверу; они не входят в CI.

## Проверенные первоисточники API (2026-09-29)

- [Vercel: TypeSafe clients and HTTP API for Jev](https://vercel.com/changelog/ai-gateway-now-supports-typesafe-clients-and-http-api-for-jev), 2026-09-21.
- [TypeSafe HTTP API](https://docs.typesafe.ai/api).
- [Kev: local server and compatible API](https://github.com/jaredpalmer/kev#run-it-locally).
