import type { Driver } from '@saturn/core';
import { flow, level, pressure } from './plugins/station-monitor';

/** Explicit simulation fixture for browser checks. No physical driver is activated. */
const driver: Driver = {
  mode: 'simulation',
  async start({ publish }) {
    let stopped = false, tick = 0, timer: ReturnType<typeof setTimeout>;
    const sample = async () => {
      if (stopped) return;
      await publish({
        [pressure.id]: 7 + Math.sin(tick / 4) * 0.4,
        [flow.id]: 11 + Math.sin(tick / 3) * 0.6,
        [level.id]: 62 + Math.sin(tick / 8) * 1.5,
      });
      tick++;
      if (!stopped) timer = setTimeout(() => { void sample().catch(console.error); }, 1000);
    };
    await sample();
    return () => { stopped = true; clearTimeout(timer); };
  },
};
export default driver;
