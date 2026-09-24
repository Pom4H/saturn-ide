import { plc, signal } from '@saturn/core';
export default plc('PLC-01', {
  semanticId:'equipment:station-controller',
  label: { en: 'Station controller', ru: 'Контроллер станции' },
  x: 670, y: 335,
  online: signal({ initial: false, description:{en:'Controller communication state',ru:'Состояние связи с контроллером'} }),
});