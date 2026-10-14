import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { playbackInitial, playbackReducer, type PlaybackStep } from './playback';

export function usePlayback(steps: PlaybackStep[], callbacks: {
  begin: () => void; visit: (step: PlaybackStep) => void; end: () => void;
}) {
  const [position, dispatch] = useReducer(playbackReducer, playbackInitial);
  const [seconds, setSeconds] = useState(8);
  const latest = useRef(callbacks); latest.current = callbacks;
  const positionRef = useRef(position); positionRef.current = position;
  const active = position.status !== 'idle';
  const playing = position.status === 'playing';
  const play = useCallback(() => {
    if (!steps.length) return;
    if (positionRef.current.status === 'idle') latest.current.begin();
    dispatch({ type: 'play', count: steps.length });
  }, [steps.length]);
  const pause = useCallback(() => dispatch({ type: 'pause', count: steps.length }), [steps.length]);
  const exit = useCallback(() => {
    if (positionRef.current.status === 'idle') return;
    dispatch({ type: 'exit', count: steps.length }); latest.current.end();
  }, [steps.length]);
  const seek = useCallback((index: number) => dispatch({ type: 'seek', count: steps.length, index }), [steps.length]);
  useEffect(() => {
    if (active && steps[position.index]) latest.current.visit(steps[position.index]);
  }, [active, position.index, position.revision, steps]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => dispatch({ type: 'tick', count: steps.length }), seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, position.index, position.revision, seconds, steps.length]);
  useEffect(() => {
    if (!active) return;
    const hidden = () => { if (document.hidden) pause(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement)?.closest('.chat-dialog, [role="dialog"]')) exit();
    };
    document.addEventListener('visibilitychange', hidden); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('keydown', escape); };
  }, [active, pause, exit]);
  return { ...position, active, playing, seconds, setSeconds, play, pause, seek, exit, step: active ? steps[position.index] : undefined, count: steps.length };
}
