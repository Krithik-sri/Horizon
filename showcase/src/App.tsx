import { AnimatePresence, motion } from 'framer-motion';
import { Compass, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Aurora } from './shell/Aurora';
import { PhoneFrame } from './shell/PhoneFrame';
import { ScreenHost } from './shell/ScreenHost';
import { TourRail } from './shell/tour/TourRail';
import { ScenarioDeck } from './shell/scenario/ScenarioDeck';
import './shell/shell.css';

/** Fit the 844px-tall phone into short desktop viewports. */
function usePhoneScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const f = () => setScale(Math.min(1, (window.innerHeight - 48) / 844));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return scale;
}

function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px);
  useEffect(() => {
    const f = () => setNarrow(window.innerWidth < px);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [px]);
  return narrow;
}

export default function App() {
  const scale = usePhoneScale();
  const compact = useNarrow(1180);
  const mobile = useNarrow(600);
  const [drawer, setDrawer] = useState<'tour' | 'deck' | null>(null);

  useEffect(() => {
    if (!compact) setDrawer(null);
  }, [compact]);

  return (
    <div data-register="shell" className={`stage ${compact ? 'is-compact' : ''} ${mobile ? 'is-mobile' : ''}`}>
      <Aurora />

      {!compact && (
        <aside className="rail rail-left">
          <TourRail />
        </aside>
      )}

      <main className="stage-center">
        {mobile ? (
          <div className="phone-full">
            <PhoneFrame bare>
              <ScreenHost />
            </PhoneFrame>
          </div>
        ) : (
          <div className="phone-scaler" style={{ transform: `scale(${scale})` }}>
            <PhoneFrame>
              <ScreenHost />
            </PhoneFrame>
          </div>
        )}
      </main>

      {!compact && (
        <aside className="rail rail-right">
          <ScenarioDeck />
        </aside>
      )}

      {compact && (
        <div className="demo-pills">
          <button className="demo-pill glass glass-deep tone-violet" onClick={() => setDrawer('tour')}>
            <Compass size={16} /> Tour
          </button>
          <button className="demo-pill glass glass-deep tone-cyan" onClick={() => setDrawer('deck')}>
            <SlidersHorizontal size={16} /> Scenarios
          </button>
        </div>
      )}

      <AnimatePresence>
        {compact && drawer && (
          <motion.div className="drawer-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drawer-backdrop" onClick={() => setDrawer(null)} />
            <motion.aside
              className={`drawer drawer-${drawer === 'tour' ? 'left' : 'right'}`}
              initial={{ x: drawer === 'tour' ? '-105%' : '105%' }}
              animate={{ x: 0 }}
              exit={{ x: drawer === 'tour' ? '-105%' : '105%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 36 }}
            >
              <button className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close">
                <X size={18} />
              </button>
              {drawer === 'tour' ? <TourRail onNavigate={() => setDrawer(null)} /> : <ScenarioDeck />}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
