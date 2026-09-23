import { plc } from '@saturn/core';
import { signals } from '../signals';
export default plc('PLC-01', {
  label: { en: 'Station controller', ru: 'Контроллер станции' },
  x: 670, y: 335, online: signals.online,
});
