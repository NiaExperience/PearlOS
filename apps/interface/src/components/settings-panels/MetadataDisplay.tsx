/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { X, Plus, Trash2 } from 'lucide-react';
import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';

import { Button } from '@interface/components/ui/button';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { formatMetadataKey, valueToEditString, editStringToValue, formatValueForDisplay } from '@interface/lib/metadata-utils';

interface MetadataDisplayProps {
  metadata: Record<string, unknown>;
  onSave?: (updatedMetadata: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export interface MetadataDisplayRef {
  getCurrentMetadata: () => Record<string, unknown>;
}

/**
 * Component to display and optionally edit metadata fields
 */
export const MetadataDisplay = forwardRef<MetadataDisplayRef, MetadataDisplayProps>(
  ({ metadata, onSave, readOnly = true }, ref) => {
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [localMetadata, setLocalMetadata] = useState<Record<string, unknown>>(metadata);
    const [isAddingNewField, setIsAddingNewField] = useState(false);
    const [newFieldKey, setNewFieldKey] = useState('');
    const [newFieldValue, setNewFieldValue] = useState('');
    const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);

    // Update local metadata when prop changes
    useEffect(() => {
      setLocalMetadata(metadata);
    }, [metadata]);

    // Expose method to get current metadata
    useImperativeHandle(ref, () => ({
      getCurrentMetadata: () => localMetadata,
    }));

    const handleEdit = (key: string, value: unknown) => {
      setEditingKey(key);
      setEditValue(valueToEditString(value));
    };

    const handleCancel = () => {
      setEditingKey(null);
      setEditValue('');
    };

    const handleSave = (key: string) => {
      try {
        const updatedMetadata = { ...localMetadata };
        const newValue = editStringToValue(editValue, localMetadata[key]);
        updatedMetadata[key] = newValue;
        setLocalMetadata(updatedMetadata);
        setEditingKey(null);
        setEditValue('');
      } catch (error: any) {
        alert(`Error saving field: ${error.message}`);
      }
    };

    const handleDelete = (key: string) => {
      setConfirmingDeleteKey(key);
    };

    const confirmDelete = () => {
      if (confirmingDeleteKey) {
        const updatedMetadata = { ...localMetadata };
        delete updatedMetadata[confirmingDeleteKey];
        setLocalMetadata(updatedMetadata);
        setConfirmingDeleteKey(null);
      }
    };

    const cancelDelete = () => {
      setConfirmingDeleteKey(null);
    };

    const handleAddNewField = () => {
      if (!newFieldKey.trim()) {
        return;
      }

      const updatedMetadata = { ...localMetadata };
      const trimmedKey = newFieldKey.trim();
      
      // Validate key
      try {
        formatMetadataKey(trimmedKey); // This will throw if key is invalid
      } catch (error: any) {
        alert(`Invalid key: ${error.message}`);
        return;
      }

      // Use editStringToValue to safely parse and sanitize the value
      try {
        const value = editStringToValue(newFieldValue.trim(), newFieldValue.trim() ? undefined : null);
        updatedMetadata[trimmedKey] = value;
      } catch (error: any) {
        alert(`Invalid value: ${error.message}`);
        return;
      }

      setLocalMetadata(updatedMetadata);
      setNewFieldKey('');
      setNewFieldValue('');
      setIsAddingNewField(false);
    };

    const handleCancelAddNew = () => {
      setIsAddingNewField(false);
      setNewFieldKey('');
      setNewFieldValue('');
    };

    const renderValue = (key: string, value: unknown): React.ReactNode => {
      if (editingKey === key && !readOnly) {
        // Render editing interface
        const isArray = Array.isArray(value);
        const placeholder = isArray
          ? 'Enter items, one per line:\nplaying keyboards\nplaying stringed instruments'
          : 'Enter value';

        return (
          <div className="space-y-2">
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full rounded-md border border-gray-600 bg-gray-900/50 p-3 text-sm text-gray-300 min-h-[100px] resize-y"
              placeholder={placeholder}
              style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                onClick={() => handleSave(key)}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                Save
              </Button>
              <Button
                onClick={handleCancel}
                size="sm"
                variant="outline"
                className="border-gray-600 bg-gray-700 text-gray-300 hover:bg-white hover:text-gray-900"
                style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
              >
                Cancel
              </Button>
            </div>
            {isArray && (
              <p className="text-xs text-gray-500">
                Tip: Enter one item per line. Example format: [&quot;playing keyboards&quot;, &quot;playing stringed instruments&quot;]
              </p>
            )}
          </div>
        );
      }

      // Render display interface
      if (value === null || value === undefined) {
        return <span className="text-gray-500 italic" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>—</span>;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return <span className="text-gray-500 italic" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>(empty list)</span>;
        }
        
        // Check if array contains complex objects
        const hasComplexObjects = value.some(
          (item) => typeof item === 'object' && item !== null && Object.keys(item).length > 1
        );
        
        if (hasComplexObjects) {
          // Display as YAML for better readability
          return (
            <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono bg-gray-800/50 p-2 rounded" style={{ fontFamily: 'var(--font-mono), monospace' }}>
              {formatValueForDisplay(value)}
            </pre>
          );
        }
        
        // Simple arrays: show as bullet list
        return (
          <ul className="list-disc list-inside space-y-1 ml-2" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
            {value.map((item, index) => (
              <li key={index} className="text-gray-300" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                {typeof item === 'object' ? formatValueForDisplay(item) : String(item)}
              </li>
            ))}
          </ul>
        );
      }

      if (typeof value === 'object') {
        return (
          <pre className="text-sm text-gray-300 whitespace-pre-wrap break-words font-mono bg-gray-800/50 p-2 rounded" style={{ fontFamily: 'var(--font-mono), monospace' }}>
            {formatValueForDisplay(value)}
          </pre>
        );
      }

      return <span className="text-gray-300" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>{String(value)}</span>;
    };

    return (
      <div className="space-y-4" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
        <div className="grid grid-cols-1 gap-4">
          {Object.entries(localMetadata).map(([key, value]) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`metadata-${key}`} className="text-gray-300" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                  {formatMetadataKey(key)}
                </Label>
                {!readOnly && editingKey !== key && confirmingDeleteKey !== key && (
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleEdit(key, value)}
                      size="sm"
                      variant="outline"
                      className="border-gray-600 bg-gray-700 text-gray-300 hover:bg-white hover:text-gray-900 h-7 text-xs"
                      style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => handleDelete(key)}
                      size="sm"
                      variant="outline"
                      className="border-red-600 text-white bg-red-600 hover:bg-red-700 h-7 text-xs flex items-center gap-1"
                      style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                )}
                {!readOnly && confirmingDeleteKey === key && (
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-red-300" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                      Delete &quot;{formatMetadataKey(key)}&quot;?
                    </span>
                    <Button
                      onClick={confirmDelete}
                      size="sm"
                      className="bg-red-600 hover:bg-red-700 text-white h-7 text-xs"
                      style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                    >
                      Confirm
                    </Button>
                    <Button
                      onClick={cancelDelete}
                      size="sm"
                      variant="outline"
                      className="border-gray-600 bg-gray-700 text-gray-300 hover:bg-white hover:text-gray-900 h-7 text-xs"
                      style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-gray-600 bg-gray-900/30 p-3" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                <div className="text-sm">{renderValue(key, value)}</div>
              </div>
            </div>
          ))}

          {/* Add New Field Form */}
          {!readOnly && isAddingNewField && (
            <div className="space-y-2 rounded-md border-2 border-dashed border-blue-600 bg-blue-900/10 p-4" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-gray-300" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>Add New Field</Label>
                <Button
                  onClick={handleCancelAddNew}
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-400 hover:text-gray-200"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="new-field-key" className="text-gray-300 text-xs" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                    Field Name
                  </Label>
                  <Input
                    id="new-field-key"
                    value={newFieldKey}
                    onChange={(e) => setNewFieldKey(e.target.value)}
                    placeholder="e.g., favorite_color"
                    className="border-gray-600 bg-gray-800 text-white text-sm"
                    style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-field-value" className="text-gray-300 text-xs" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                    Field Value (JSON or plain text)
                  </Label>
                  <textarea
                    id="new-field-value"
                    value={newFieldValue}
                    onChange={(e) => setNewFieldValue(e.target.value)}
                    placeholder='e.g., "blue" or ["item1", "item2"] or {"key": "value"}'
                    className="w-full rounded-md border border-gray-600 bg-gray-800 p-2 text-sm text-gray-300 min-h-[80px] resize-y"
                    style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                  />
                  <p className="text-xs text-gray-500" style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}>
                    Tip: Enter JSON for objects/arrays, or plain text for strings
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleAddNewField}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={!newFieldKey.trim()}
                  >
                    Add Field
                  </Button>
                  <Button
                    onClick={handleCancelAddNew}
                    size="sm"
                    variant="outline"
                    className="border-gray-600 bg-gray-700 text-gray-300 hover:bg-white hover:text-gray-900"
                    style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Add New Field Button */}
          {!readOnly && !isAddingNewField && (
            <Button
              onClick={() => setIsAddingNewField(true)}
              variant="outline"
              className="w-full border-dashed border-gray-600 bg-gray-700 text-gray-300 hover:bg-white hover:text-gray-900"
              style={{ fontFamily: 'var(--font-pixelify-sans), sans-serif' }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Field
            </Button>
          )}
        </div>
      </div>
    );
  }
);

MetadataDisplay.displayName = 'MetadataDisplay';

