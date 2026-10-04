import { useRef } from 'react';
export type AssistantTab = 'voice' | 'transcript';
const tabs: { id: AssistantTab; label: string }[] = [
  { id: 'voice', label: 'Conversa' },
  { id: 'transcript', label: 'Transcrição' },
];
export default function AssistantTabs({
  value,
  onChange,
}: {
  value: AssistantTab;
  onChange(value: AssistantTab): void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="assistant-tabs" role="tablist" aria-label="Modo do assistente">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          ref={(element) => {
            buttons.current[index] = element;
          }}
          role="tab"
          id={'assistant-tab-' + tab.id}
          aria-controls={'assistant-panel-' + tab.id}
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index + tabs.length - 1) % tabs.length
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(tabs[next].id);
            buttons.current[next]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
