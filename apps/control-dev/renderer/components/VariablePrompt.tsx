'use client';
import { useEffect, useRef, useState } from 'react';
import type { QuickTask } from '../lib/quickTasks';
import { substituteTemplate } from '../lib/quickTasks';

export interface VariablePromptProps {
  task: QuickTask;
  onConfirm: (finalText: string) => void;
  onCancel: () => void;
}

export function VariablePrompt({ task, onConfirm, onCancel }: VariablePromptProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of task.variables) init[v.name] = v.default ?? '';
    return init;
  });
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(substituteTemplate(task.template, values));
  }

  return (
    <div className="qt-modal-backdrop" onClick={onCancel}>
      <div
        className="qt-modal qt-varprompt"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qt-modal-head">
          <span className="qt-varprompt-title">
            {task.emoji ? `${task.emoji} ` : ''}
            {task.title}
          </span>
          <button
            type="button"
            className="qt-modal-close"
            onClick={onCancel}
            aria-label="Lukk"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="qt-varprompt-form">
          {task.variables.map((v, i) => (
            <label key={v.name} className="qt-varprompt-field">
              <span className="qt-varprompt-label">{v.prompt}</span>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="text"
                value={values[v.name] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                }
                className="qt-varprompt-input"
              />
            </label>
          ))}
          <div className="qt-varprompt-actions">
            <button
              type="button"
              className="qt-btn-secondary"
              onClick={onCancel}
            >
              Avbryt
            </button>
            <button type="submit" className="qt-btn-primary">
              Kjør
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
