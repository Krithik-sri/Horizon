import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, type ComponentType } from 'react';
import { Toasts } from '../components/fx';
import { currentRoute, useApp } from '../mock/store';
import type { Screen } from '../mock/types';
import { BootScreen } from '../screens/boot/BootScreen';
import { DepartureScreen } from '../screens/departure/DepartureScreen';
import { PlannerScreen } from '../screens/planner/PlannerScreen';
import { MotionScreen } from '../screens/motion/MotionScreen';
import { ArchiveScreen } from '../screens/archive/ArchiveScreen';
import { DetailScreen } from '../screens/detail/DetailScreen';

const REGISTER: Record<Screen, 'departure' | 'motion' | 'return'> = {
  boot: 'departure',
  departure: 'departure',
  planner: 'departure',
  motion: 'motion',
  archive: 'return',
  detail: 'return',
};

const SCREENS: Record<Screen, ComponentType> = {
  boot: BootScreen,
  departure: DepartureScreen,
  planner: PlannerScreen,
  motion: MotionScreen,
  archive: ArchiveScreen,
  detail: DetailScreen,
};

/** Drives the ride simulator at 4 Hz while the Motion screen is up. */
function useSimDriver(active: boolean) {
  const tick = useApp((s) => s.tickSim);
  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      tick(Math.min(0.5, (now - last) / 1000));
      last = now;
    }, 250);
    return () => clearInterval(id);
  }, [active, tick]);
}

export function ScreenHost() {
  const route = useApp(currentRoute);
  const direction = useApp((s) => s.direction);
  const depth = useApp((s) => s.stack.length);
  useSimDriver(route.screen === 'motion');
  const Comp = SCREENS[route.screen];
  const key = `${route.screen}:${route.params?.rideId ?? ''}:${depth}`;
  return (
    <>
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={key}
          className="screen"
          data-register={REGISTER[route.screen]}
          custom={direction}
          variants={{
            enter: (d: number) => ({ opacity: 0, x: d * 28, y: 12, scale: 0.985 }),
            center: { opacity: 1, x: 0, y: 0, scale: 1 },
            exit: (d: number) => ({ opacity: 0, x: d * -28, y: -6, scale: 0.985 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          <Comp />
        </motion.div>
      </AnimatePresence>
      <Toasts />
    </>
  );
}
