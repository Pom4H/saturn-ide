# Saturn IDE

Инженерная IDE вокруг одного TypeScript-проекта физического объекта. Без лендинга.

```sh
bun install
bun dev
```

Открыть `http://localhost:3000`. SQLite создаётся автоматически; PostgreSQL выбирается через
`DATABASE_URL`. Git должен быть установлен отдельно. Версии зависимостей в этом архитектурном
проходе не менялись; установка и полный Bun/browser прогон требуют отдельного подтверждения.

**Архитектура и границы:** [docs/architecture.md](docs/architecture.md).
**Что сохраняем из прежнего Saturn и что ещё не перенесено:** [docs/capabilities.md](docs/capabilities.md).
**Фактически выполненные проверки:** [docs/verification.md](docs/verification.md).

## Разработка и исполнение

В `src/workspace` находятся рабочие файлы, Git, Language Service и сборка. В `src/runtime` —
SCADA, SQL, SSE/push и владение применённой сборкой. `src/host/dev.ts` соединяет их для локального
запуска. `src/shell` — текущий UI с 2D/3D, редактором, сигналами, HMI и отчётами.

Существующий renderer не перерисовывался при перемещении. Полная функциональная/визуальная
эквивалентность старому Saturn не заявляется: незавершённый перенос перечислен явно.

Автоматический preview допускается только для доверенного проекта с simulator-драйвером,
когда текущая установка тоже не live. Для полностью ручного применения:

```sh
SATURN_PREVIEW=manual bun dev
```

`GET /api/releases` возвращает source provenance, checked, published, applied и phase.
`POST /api/publish` принимает `{ hash, expectedPublished }`.
`POST /api/apply` принимает `{ hash, expectedApplied }`.
Во всех POST нужны JSON и `X-Saturn-Key` из `/api/state` или `/api/releases`.
Для live-команд обязателен `expectedApplied`, а для live-сборки — записанный lockfile.
Управление release из самого Shell и отдельный draft preview для live-среды ещё не завершены.

Применённые сборки сохраняются в SQL и восстанавливаются до чтения рабочего проекта.
Артефакт `saturn.build@2` включает модель, bundled driver, хеши исходников/ядра/lockfile и
версию builder. Это доверенный исполняемый код, не sandbox и не подписанный пакет.

Dev пока остаётся одним процессом на loopback. Не использовать его как публичный SCADA-сервер
или считать доказанной независимость runtime от сбоев редактора. Isolation/runtime-only host,
роли, реальные промышленные драйверы и аппаратная проверка остаются обязательными этапами.

## Проекты и расширения

```sh
bun run scaffold project ../another-station
SATURN_PROJECT=../another-station bun dev
bun run scaffold plc plc-01
bun run scaffold plugin pressure-switch
```

Скопированные файлы подключаются явными imports. Реальный compiler/toolchain задаётся в
`equipment/<device>/compiler.ts`; `bun run firmware equipment/<device>` запускается явно.
Шаблон не создаёт фиктивную прошивку.

## Проверки

```sh
bun run architecture:check
bun run check
bun test tests
bunx playwright install chromium
bun run test:browser
```

Полный набор проверяет не только новую структуру, но и прежние сценарии. PostgreSQL-тесты
включаются через `TEST_POSTGRES_URL`. Оригинальное описание предыдущего MVP сохранено в
[docs/mvp-before-foundation.md](docs/mvp-before-foundation.md) как исторический документ;
его старые заявления о выполненных проверках не относятся к текущему коммиту.
