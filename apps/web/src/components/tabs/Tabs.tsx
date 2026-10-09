"use client";
import { type ReactNode, useId, useRef, useState } from "react";

export function Tabs({
  label,
  items,
}: {
  label: string;
  items: { id: string; label: string; content: ReactNode }[];
}) {
  const prefix = useId(),
    [active, setActive] = useState(items[0].id),
    buttons = useRef<(HTMLButtonElement | null)[]>([]),
    invalid = useRef(false);
  return (
    <div
      className="tabs"
      onInvalidCapture={(event) => {
        // Reveal the first invalid field even when it belongs to a hidden tab.
        const field = event.target as HTMLInputElement,
          panel = field.closest<HTMLElement>("[data-tab-panel]");
        if (!panel?.hidden || !panel.dataset.tabPanel) return;
        event.preventDefault();
        if (invalid.current) return;
        invalid.current = true;
        setActive(panel.dataset.tabPanel);
        requestAnimationFrame(() => {
          field.focus();
          field.reportValidity();
          invalid.current = false;
        });
      }}
    >
      <div className="tab-list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${item.id}`}
            aria-controls={`${prefix}-panel-${item.id}`}
            aria-selected={active === item.id}
            tabIndex={active === item.id ? 0 : -1}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % items.length
                  : event.key === "ArrowLeft"
                    ? (index + items.length - 1) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setActive(items[next].id);
              buttons.current[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <section
          key={item.id}
          className="tab-panel"
          role="tabpanel"
          id={`${prefix}-panel-${item.id}`}
          aria-labelledby={`${prefix}-tab-${item.id}`}
          data-tab-panel={item.id}
          hidden={active !== item.id}
        >
          {item.content}
        </section>
      ))}
    </div>
  );
}
