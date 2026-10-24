import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
const slots = new Map<string, {element: HTMLDivElement; active: boolean}>();
const listeners = new Map<string, Set<() => void>>();
function notify(id: string) { for (const listener of listeners.get(id) ?? []) listener(); }
/** A visual window supplies a destination; it never creates a second terminal consumer. */
export function TerminalSlot({id, active}: {id: string; active: boolean}) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = {element: host.current!, active}; slots.set(id, slot); notify(id);
    return () => { if (slots.get(id) === slot) {slots.delete(id); notify(id);} };
  }, [id, active]);
  return <div ref={host} style={{height:'100%',minHeight:0,display:'flex',flex:1}}/>;
}
/** Move the same DOM host between views. React, xterm, pending input and the PTY stay mounted. */
export function SharedTerminalMount({id, visual, active, children}: {
  id: string; visual: boolean; active: boolean; children: (active: boolean) => ReactNode;
}) {
  const [container] = useState(() => {const el=document.createElement('div');el.style.cssText='height:100%;width:100%;min-height:0;flex:1';return el;});
  const plain = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const update = () => {
      const slot = visual ? slots.get(id) : undefined;
      const destination = slot?.element ?? plain.current;
      if (destination && container.parentElement !== destination) destination.appendChild(container);
      setVisible(active && (!visual || !!slot?.active));
    };
    const group = listeners.get(id) ?? new Set<() => void>(); group.add(update);listeners.set(id,group);update();
    return () => {group.delete(update);if(!group.size)listeners.delete(id);};
  }, [id,visual,active,container]);
  return <><div ref={plain} style={{height:'100%',minHeight:0,display:!visual&&active?'flex':'none',flex:1}}/>{createPortal(children(visible),container)}</>;
}

