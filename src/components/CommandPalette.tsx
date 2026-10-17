import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';

export type Command = {
  id: string;
  label: string;
  group: string;
  icon: ComponentType<{ size?: number }>;
  keywords?: string;
  run: () => void;
};

export function CommandPalette({
  commands,
  close,
}: {
  commands: Command[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) => {
      const text =
        `${command.label} ${command.group} ${command.keywords || ''}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [commands, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  function run(command?: Command) {
    if (!command) return;
    close();
    command.run();
  }
  let previousGroup = '';
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Command menu"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="palette-input">
        <Search size={18} />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={
            results[index] ? `command-${results[index].id}` : undefined
          }
          placeholder="Search pages and actions…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(results[index]);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="palette-results"
        id="palette-results"
        role="listbox"
        ref={list}
      >
        {results.length === 0 && (
          <p className="palette-empty">No matching pages or actions.</p>
        )}
        {results.map((command, position) => {
          const heading = command.group !== previousGroup;
          previousGroup = command.group;
          return (
            <div key={command.id}>
              {heading && (
                <div className="palette-group" role="presentation">
                  {command.group}
                </div>
              )}
              <button
                id={`command-${command.id}`}
                role="option"
                aria-selected={position === index}
                data-index={position}
                className={position === index ? 'active' : ''}
                onMouseMove={() => setIndex(position)}
                onClick={() => run(command)}
                tabIndex={-1}
              >
                <command.icon size={18} />
                <span>{command.label}</span>
                {position === index && <CornerDownLeft size={16} />}
              </button>
            </div>
          );
        })}
      </div>
    </dialog>
  );
}
