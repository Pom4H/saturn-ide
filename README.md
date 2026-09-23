# Saturn IDE

Инженерный проект на TypeScript: оборудование, сигналы, трубы и тревоги. Один локальный процесс Bun обслуживает IDE, SCADA, SSE, историю, Git и Web Push. Без лендинга.

```sh
bun install
bun dev
```

Открыть `http://localhost:3000`. Git должен быть установлен отдельно. SQLite создаётся автоматически в `.saturn/`; PostgreSQL не нужен для первого запуска.

```sh
DATABASE_URL=postgres://user:password@localhost:5432/saturn bun dev
SATURN_PROJECT=./project PORT=3001 bun dev
```

## Что попробовать

Открывается настоящая насосная станция, явно помеченная как **симуляция**. Перетащите насос: координаты меняются в TS-редакторе уже во время движения, трубы следуют за ним. Отпустите мышь — изменится исходный файл. Escape отменяет движение. На небольшом экране код открывается кнопкой «Код».

Наведите курсор на `pump`, `tank`, `pipe`, `signal` в редакторе. Подсказки, автодополнение и диагностику выдаёт настоящий TypeScript Language Service. RU/EN переключает интерфейс и JSDoc, а не имя API. Доменные ошибки имеют RU/EN; оригинальные сообщения ошибок компилятора TypeScript остаются на английском.

Выберите насос и нажмите «Стоп». Отправленная команда не подменяет телеметрию: вращение останавливается после показаний драйвера. Закройте выходной клапан до 0%: демонстрационный драйвер поднимет давление до 5.8 bar и активирует тревогу. Квитирование сохраняется в БД, но не снимает причину тревоги. Верните клапан на 75%.

Вкладки снизу показывают сигналы, журнал тревог, историю измерений и настоящий Git diff. Commit затрагивает только каталог проекта, не чужие staged-файлы. Pull — только fast-forward; никаких reset, force-push или автоматического разрешения конфликтов. Для коммитов настройте свои `git config user.name` и `user.email`; для push/pull — remote и учётные данные Git.

`/hmi` — браузерный HMI того же проекта, с навигацией по оборудованию и тем же SVG-рендерером. Проверяется в viewport 320×240. Это не прошивка физического дисплея.

## Файлы вместо инфраструктуры плагинов

```text
project/
  project.ts                   # Единая модель; обычные TS imports
  server.ts                    # Экспорт выбранного Driver
  plugins/
    simulation.ts              # Копируемый драйвер-пример
  equipment/
    plc-01/                    # Создаётся скафолдингом
      device.ts                # PLC и типизированные сигналы
      hmi.ts                   # Вид на те же объекты оборудования
      compiler.ts              # Реальный vendor toolchain подключается здесь
      firmware/                # Исходники и конфигурация целевой платы
```

```sh
bun run scaffold plc plc-01
bun run scaffold plugin pressure-switch
bun run scaffold project ../another-station
bun run firmware equipment/plc-01
```

Генератор не перезаписывает существующие файлы. Добавьте обычные импорты новых устройств и сигналов в `project.ts`; HMI-конфигурацию можно передать как `hmi`. Для нового драйвера замените экспорт в `server.ts`. Расширение принадлежит проекту: скопируйте каталог и изменяйте его код. Нет магазина, manifest, контейнера зависимостей, loader API или глобальной регистрации.

`compiler.ts` получает только `outDir` и `run(argv)`. Сборка запускается **явной CLI-командой**, не при открытии файла. Шаблон отказывается собирать прошивку, пока не настроен реальный компилятор конкретного ПЛК. Он не выдаёт JSON или случайные байты за `.bin`. Прошивка/прошивальщик, регистры MCU, промышленный протокол и целевой HMI backend в этом MVP не реализованы.

## Сервер

`Bun.serve` отдаёт React/CodeMirror через HTML import и API с того же origin. `Bun.SQL` используется напрямую: один набор параметризованных запросов для SQLite и PostgreSQL, без ORM. В БД лежат измерения, события тревог и push-подписки. Модели проекта в БД нет. История измерений по умолчанию хранится семь дней; журнал тревог сохраняется.

Сигналы имеют тип, единицу измерения, границы, время последнего измерения и качество. Нет данных/обрыв SSE не рисуются как исправная установка. Через пять секунд без новых измерений (или `staleAfter` сигнала) значение становится stale. Начальные значения не считаются измеренными. После перезапуска исторические значения тоже stale, пока драйвер их не подтвердит.

SSE отправляет полное состояние при подключении и восстановлении связи. Есть heartbeat и отключение медленных потребителей вместо бесконечного роста очереди. Сохранение файла проверяет его версию; чужие изменения возвращают HTTP 409. Изменение координат использует числовые диапазоны TypeScript AST, сохраняет комментарии и форматирование. Вычисляемые координаты не переписываются. Ошибка компиляции оставляет работающей предыдущую корректную модель. Правка схемы не перезапускает драйвер.

Основные маршруты: `GET /api/state`, `/api/events`, `/api/files`, `/api/file?path=project.ts`, `/api/history?signal=station.pressure`, `/api/alarms`, `/api/git`; `POST /api/file`, `/api/language`, `/api/telemetry`, `/api/command`, `/api/ack`, `/api/git`, `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test`. POST требует JSON и `X-Saturn-Key` из `/api/state`. Телеметрия принимается как `{ "values": { "station.pressure": 3.2 } }`; команда — `{ "signal": "pump.run", "value": false }`.

Web Push запускается вместе с сервером. VAPID-ключи генерируются локально, сохраняются вне Git; кнопка уведомлений регистрирует service worker и подписку браузера. Push отправляется по фронту тревоги, а не на каждом измерении; истёкшие подписки удаляются. Для настоящей доставки нужны разрешение пользователя, поддерживающий Web Push браузер, доступ к его push-провайдеру и secure context (localhost либо HTTPS). Доставка на конкретное устройство не имитируется тестами.

## Граница доверия и MVP

IDE привязана к `127.0.0.1`; здесь нет обещания безопасного публичного multi-user сервера. Проверяются Origin/Host, session key, пути, версии файлов и типы входных значений. API не читает `.env`, `.git`, внешние пути или скрытые цели симлинков. Push endpoints ограничены провайдерами, чтобы не превращать подписку в произвольный исходящий запрос.

**Открываемый проект должен быть доверенным.** TypeScript и скопированные драйверы исполняются с правами пользователя, как локальные build scripts. Это не sandbox для чужого кода. Здесь нет удалённых ролей, HA, гарантированного real-time, сертифицированной автоматики, физического Modbus/OPC UA драйвера, PLC firmware backend или системы аварийного останова. Маршрутизация труб ортогональная по портам, без поиска маршрута вокруг препятствий. Демонстрационная гидравлика не является расчётной моделью сооружения.

## Проверки

```sh
bun run check
bun test tests
bunx playwright install chromium
bun run test:browser
```

`TEST_POSTGRES_URL=postgres://... bun test tests/store.test.ts` включает контрактный тест с реальной БД; без URL он явно пропускается. CI поднимает PostgreSQL и выполняет все проверки одним заданием. Browser test запускает именно `bun dev`, использует реальный интерфейс, проверяет drag до drop, обе локали JSDoc, команды, тревоги, Git и сохраняет настоящие скриншоты в `artifacts/`. Нет лендинга и поддельных UI-изображений. После первого успешного прогона CI фиксирует только полученный `bun.lock`, не переписывая исходники.

Геометрия насоса, резервуара и клапана перенесена из `Pom4H/saturn/src/equipment-svg.ts`, commit `90da21a1885a72022b7a2d1b45cb36993bee1597`, с сохранением исходных координат и деталей. Инженерный и операторский режимы используют один компонент.

## English

Run `bun install` and `bun dev`, then open `http://localhost:3000`. A single Bun process serves the IDE, SCADA runtime, SSE, history, Git and Web Push. SQLite works out of the box; set `DATABASE_URL` to use PostgreSQL. Switch the UI to EN for English labels and genuine TypeScript JSDoc.

The filesystem and TypeScript imports define the project; Git stores its history. Copy plugins into the project and import them normally. There is no second JSON project model, ORM, plugin registry, marketplace, or landing page. The sample station is explicitly simulated. Device-specific firmware compilation, industrial protocol drivers and a physical-display backend require real target implementations; the scaffold never pretends they already exist. Open trusted local projects only.
