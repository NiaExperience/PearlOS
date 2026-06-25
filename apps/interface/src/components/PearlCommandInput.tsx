'use client';

import React, { useCallback, useState } from 'react';
import { WandSparkles } from 'lucide-react';

export interface PearlCommandInputProps {
  placeholder: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onCommandInput?: (value: string) => void;
}

export function PearlCommandInput({
  placeholder,
  ariaLabel = 'Pearl command input',
  className = '',
  disabled = false,
  onCommandInput,
}: PearlCommandInputProps) {
  const [value, setValue] = useState('');

  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setValue(next);
    onCommandInput?.(next);
  }, [onCommandInput]);

  return (
    <div className={`pearl-command-input ${className}`.trim()}>
      <WandSparkles className="pearl-command-input-icon" size={18} aria-hidden="true" />
      <input
        aria-label={ariaLabel}
        autoComplete="off"
        className="pearl-command-input-field"
        disabled={disabled}
        onChange={handleChange}
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={value}
      />
    </div>
  );
}

export default PearlCommandInput;
