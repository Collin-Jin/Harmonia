import { useEffect, type RefObject } from 'react';

/** Marks a scroll box with `more-above` / `more-below` while there is content past that edge. */
export function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.classList.toggle('more-above', el.scrollTop > 2);
      el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    };
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // panels opening and closing change the height without resizing the box itself
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    update();
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref]);
}
