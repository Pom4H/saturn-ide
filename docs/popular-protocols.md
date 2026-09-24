# Modbus, MQTT и OPC UA

Плагины находятся в `project/plugins/protocols`. Копируйте нужный модуль вместе с
`shared.ts` в свой проект и подключайте обычным import. Нет регистрации плагинов
или отдельного списка тегов: используется `Signal.binding` и `acquire()`.

SDK загружаются только внутри `connect()`. Импорт проекта, проверка и сборка не
подключаются к приборам, не создают PKI и не открывают serial port.

## Зависимости

В каталоге своего проекта установить только используемые SDK и сохранить bun.lock:

```sh
bun add modbus-serial                  # Modbus TCP/RTU; RTU требует native serialport
bun add mqtt                           # MQTT
bun add node-opcua-client node-opcua-certificate-manager  # OPC UA
```

Для разработки IDE эти SDK и тестовые серверы установлены как devDependencies.
В рабочем runtime они должны быть установлены по тому же lockfile. Bundle содержит
наш драйвер, но не встраивает SDK: так сохраняются native bindings, certificates и
ресурсы Node-пакетов. node_modules должен разрешаться из каталога runtime/builds.
Удалённый перенос одного JSON BuildArtifact без зависимостей недостаточен.
Автоматическая установка пакетов при apply не выполняется.

## Modbus TCP и RTU

```ts
import { signal, pump } from '@saturn/core';
import { modbusTcp, modbusRtu } from './plugins/protocols/modbus';

export const plc = modbusTcp('PLC-01', { host: '192.168.10.20', port: 502 }, { pollMs: 250 });
// Альтернатива: одна сессия на всю последовательную шину, unit задан в адресах.
export const bus = modbusRtu('RS485-01', { path: '/dev/ttyUSB0', baudRate: 19200, parity: 'even' });

export const pump1 = pump('P-01', {
  x: 100, y: 100, label: 'Насос',
  rpm: plc.bind(signal({ initial: 0, unit: 'rpm' }), {
    unit: 1, area: 'holding', offset: 100, format: 'uint16',
  }),
  run: plc.bind(signal({ initial: false, writable: true }), {
    unit: 1, area: 'coil', offset: 0,
  }),
});
```

Это пример адресации, НЕ карта регистров Saturn PLC-500. Использовать документацию
конкретного прибора. `offset` начинается с нуля, а не с 40001.

Чтения: FC1/2/3/4; записи: FC5/6/16. Форматы uint16/int16/uint32/int32/float32,
порядки ABCD/CDAB/BADC/DCBA для 32 бит, преобразование `raw * scale + bias`.
Обратное преобразование команды проверяет диапазон и целочисленность без усечения.
Соседние регистры объединяются в пакеты до 125, биты до 2000. Разрывы адресов не
запрашиваются, разные unit/area не объединяются. Broadcast запрещён.

Modbus exception делает соответствующие сигналы bad. Транспортная ошибка требует
закрытия и восстановления всей сессии. Для RTU это вся шина, а не независимое
резервирование каждого slave; изоляция постоянно молчащего slave пока не реализована.
Modbus TCP не зашифрован: подключать внутри защищённой сети, не публиковать в интернет.

## MQTT

```ts
import { mqtt } from './plugins/protocols/mqtt';
export const broker = mqtt('telemetry', {
  url: 'mqtts://broker.example:8883',
  credentials: () => ({ username: process.env.MQTT_USER, password: process.env.MQTT_PASSWORD }),
});
// В определении оборудования:
// rpm: broker.bind(signal({initial:0}), {topic:'plant/P-01/rpm', format:'json'})
// run: broker.bind(signal({initial:false,writable:true}), {
//   topic:'plant/P-01/run/state', commandTopic:'plant/P-01/run/set'
// })
```

MQTT 3.1.1 (`version:4`) и 5 (`version:5`, default); TCP/TLS и WS/WSS через MQTT.js.
Plain MQTT/WS требует `allowInsecure:true`. Проверка сертификата TLS не отключается.
Только точные topic, без wildcard. Форматы: JSON-скаляр, text, sample
`{value,quality,sourceAt?,sequence?}`; JSON path — массив ключей, не выражение.
Retained-пакет по умолчанию stale; можно указать `retained:'ignore'`.
Брокерный keepalive не освежает прибор. Прибор должен публиковать состояние с
периодом, согласованным с staleAfter. Дедупликации sequence и MQTT-history нет.

Подписки используют handleMessage с await emit/backpressure. Команды публикуются
QoS1 и retain=false, без SDK-reconnect и offline queue. PUBACK означает принятие
брокером, не подтверждение исполнительного механизма. QoS не гарантирует
exactly-once физическое действие; повтор на уровне устройства требует своего ID.
После переподключения старые команды не переотправляются.

## OPC UA

```ts
import { readFileSync } from 'node:fs';
import { opcua } from './plugins/protocols/opcua';
export const ua = opcua('line', {
  endpoint: 'opc.tcp://plc.example:4840', pkiDir: '/var/lib/saturn/pki/line',
  security: {
    mode: 'SignAndEncrypt', policy: 'Basic256Sha256',
    serverCertificate: () => readFileSync('/etc/saturn/line-server.der'),
  },
});
// temperature: ua.bind(signal({initial:0,unit:'°C'}), {
//   nodeId:'ns=2;s=temperature', dataType:'Double'
// })
```

Явно доверенный сертификат задаётся runtime-функцией; автоматического доверия
найденному серверу нет. Режим без security допускается только с allowInsecure.
Пароль разрешён только с SignAndEncrypt. Ключи/PKI находятся вне Git.

Реализовано пакетное чтение Value (maxAge=0), проверка скалярного dataType, sourceTimestamp
и типизированная запись с проверкой StatusCode. Поддержаны Boolean, String, SByte/Byte,
Int16/UInt16/Int32/UInt32, Float/Double. Arrays, Int64/UInt64, ExtensionObject,
Browse, subscriptions, HistoryRead и Events не реализованы. Namespace index задаётся
явно; его соответствие серверу нужно проверить при интеграции.
Bad/Uncertain/неожиданный тип не превращаются в good. Uncertain пока консервативно
отображается как bad: полная модель OPC UA StatusCode не помещается в текущий Quality.

## Исполнение

```ts
import { acquire } from '@saturn/scada/acquisition';
import { plc, broker, ua } from './connections';
export default acquire(plc, broker, ua);
```

Сохранение исходника не запускает live-соединения. Publish/apply и права на команды
остаются обязанностями host/runtime. Проверку канала defineProtocol.validate
выполняет при bind и повторно при prepare после JSON-транспорта, до открытия сети.

## Проверки

`bun test tests/protocols.test.ts` использует настоящий TCP, MQTT-брокер Aedes,
node-opcua сервер с защищённым каналом и Linux PTY для RTU. PTY проверяет программный
serial/CRC путь, но не USB-адаптер, RS485 timing/noise или физический контроллер.
Тесты кодеков используют независимые векторы, а не только encode/decode roundtrip.
Наличие теста само по себе не означает его успешный запуск; результат CI фиксируется
отдельно после выполнения. Аппаратной приёмки не проводилось.

## Первичные источники

- https://github.com/yaacov/node-modbus-serial
- https://github.com/mqttjs/MQTT.js (reconnectPeriod, queueQoSZero, handleMessage)
- https://github.com/node-opcua/node-opcua
- https://reference.opcfoundation.org/Core/Part4/v105/docs/7.11
- https://bun.sh/docs/bundler (external packages)
