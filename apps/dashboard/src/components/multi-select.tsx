'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { Badge } from '@dashboard/components/ui/badge';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@dashboard/components/ui/command';
import { Command as CommandPrimitive } from 'cmdk';

type Framework = Record<'value' | 'label', string>;

export function FancyMultiSelect({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; description?: string }[];
  value?: string[];
  onChange?: (value: string[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>(value || []);
  const [inputValue, setInputValue] = React.useState('');

  // Update local state only when value prop changes and is different from current selection
  React.useEffect(() => {
    if (value && JSON.stringify(value) !== JSON.stringify(selected)) {
      setSelected(value);
    }
  }, [value]);

  // Update the handleUnselect to call onChange directly
  const handleUnselect = React.useCallback(
    (value: string) => {
      const newSelected = selected.filter((s) => s !== value);
      setSelected(newSelected);
      onChange?.(newSelected);
    },
    [selected, onChange]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const input = inputRef.current;
      if (input) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (input.value === '') {
            setSelected((prev) => {
              const newSelected = [...prev];
              newSelected.pop();
              return newSelected;
            });
          }
        }
        // This is not a default behaviour of the <input /> field
        if (e.key === 'Escape') {
          input.blur();
        }
      }
    },
    []
  );

  const selectables = options.filter(
    (option) => !selected.includes(option.value)
  );

  console.log(selectables, selected, inputValue);

  return (
    <Command
      onKeyDown={handleKeyDown}
      className='overflow-visible bg-transparent'
    >
      <div className='group rounded-md border border-input px-3 py-2 text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 bg-background'>
        <div className='flex flex-wrap gap-1'>
          {selected.map((value) => {
            const option = options.find((option) => option.value === value);
            return (
              <Badge key={value}>
                {option?.label}
                <button
                  className='ml-1 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2'
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleUnselect(value);
                    }
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => handleUnselect(value)}
                >
                  <X className='h-3 w-3 text-muted-foreground hover:text-foreground' />
                </button>
              </Badge>
            );
          })}
          {/* Avoid having the "Search" Icon */}
          <CommandPrimitive.Input
            ref={inputRef}
            value={inputValue}
            onValueChange={setInputValue}
            onBlur={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            placeholder='Select options...'
            className='ml-2 flex-1 outline-none placeholder:text-muted-foreground bg-background'
          />
        </div>
      </div>
      <div className='relative mt-2'>
        <CommandList>
          {open && selectables.length > 0 ? (
            <div className='absolute top-0 z-10 w-full rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in'>
              <CommandGroup className='h-full overflow-auto'>
                {selectables.map((option) => {
                  return (
                    <CommandItem
                      key={option.value}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onSelect={(value) => {
                        setInputValue('');
                        const newSelected = [...selected, option.value];
                        setSelected(newSelected);
                        onChange?.(newSelected);
                      }}
                      className={'cursor-pointer'}
                    >
                      <div className='flex flex-col items-start'>
                        <div className='flex items-center gap-2 font-bold'>
                          {option.label}
                        </div>
                        <div className='flex items-center gap-2 text-muted-foreground'>
                          {option.description}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </div>
          ) : null}
        </CommandList>
      </div>
    </Command>
  );
}
