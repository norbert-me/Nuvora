import { useState, useEffect, useRef } from 'react';

export function Timer({ seconds, running, onTimeUp, countUp }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setElapsed(prev => {
        const next = prev + 1;
        if (!countUp && next >= seconds) {
          clearInterval(interval);
          onTimeUp?.();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  const display = countUp ? elapsed : Math.max(0, seconds - elapsed);
  const mins = Math.floor(display / 60);
  const secs = display % 60;

  return (
    <div className={`timer ${countUp ? 'counting-up' : ''}`}>
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </div>
  );
}

export function useElapsedTime(running) {
  const startRef = useRef(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (running && !startRef.current) {
      startRef.current = Date.now();
    }
    if (!running && startRef.current) {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      startRef.current = null;
    }
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      if (startRef.current) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  return elapsed;
}
