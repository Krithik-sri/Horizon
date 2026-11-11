import { useEffect, useState, type ReactNode } from 'react';
import { Signal, Wifi, BatteryFull } from 'lucide-react';
import './shell.css';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** 390×844 device: rounded bezel, dynamic island, status bar, home indicator. */
export function PhoneFrame({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const time = useClock();
  return (
    <div className={`phone ${bare ? 'phone-bare' : ''}`}>
      <div className="phone-screen">
        {children}
        <div className="phone-status">
          <span className="phone-time">{time}</span>
          <span className="phone-island" />
          <span className="phone-icons">
            <Signal size={15} strokeWidth={2.5} />
            <Wifi size={15} strokeWidth={2.5} />
            <BatteryFull size={20} strokeWidth={2} />
          </span>
        </div>
        <div className="phone-home" />
      </div>
    </div>
  );
}
