import { signal } from '@saturn/core';
import { saturnPlc500 } from '../plugins/saturn-plc500';
export default saturnPlc500('PLC-01', {
  semanticId:'equipment:station-controller',
  label:{en:'Station controller',ru:'Контроллер станции'},
  x:670,y:335,
  online:signal({initial:false,description:{en:'Controller communication state',ru:'Состояние связи с контроллером'}}),
});
