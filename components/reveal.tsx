"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type RevealCallback = () => void;

const revealCallbacks = new WeakMap<Element, RevealCallback>();
let revealObserver: IntersectionObserver | undefined;

function observeReveal(element: Element, callback: RevealCallback) {
  if (!("IntersectionObserver" in window)) {
    callback();
    return () => undefined;
  }

  revealObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealCallbacks.get(entry.target)?.();
        revealCallbacks.delete(entry.target);
        revealObserver?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10%", threshold: 0.12 },
  );

  revealCallbacks.set(element, callback);
  revealObserver.observe(element);

  return () => {
    revealCallbacks.delete(element);
    revealObserver?.unobserve(element);
  };
}

type RevealProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  delay?: number;
};

export function Reveal({
  children,
  className,
  delay = 0,
  style,
  ...props
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return observeReveal(element, () => setVisible(true));
  }, []);

  return (
    <div
      {...props}
      ref={ref}
      data-visible={visible || undefined}
      className={["reveal-on-scroll", className].filter(Boolean).join(" ")}
      style={{ ...style, "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
