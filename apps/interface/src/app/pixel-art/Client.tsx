'use client';

import React, { useState, useCallback, useEffect } from 'react';
import '@interface/styles/pixel-ui.css';

type PixelArtType =
  | 'icon' | 'button' | 'badge' | 'frame' | 'divider'
  | 'character' | 'background';
type IconSize = 16 | 32 | 48 | 64;
type CharacterSize = 256 | 512;

const ICON_TYPES: PixelArtType[] = ['icon', 'button', 'badge', 'frame', 'divider'];

interface GeneratedAsset {
  id: string;
  type: PixelArtType;
  description: string;
  // Final pixel dimensions of the generated asset.
  width: number;
  height: number;
  imageUrl: string;
  timestamp: number;
}

const TYPE_OPTIONS: { value: PixelArtType; label: string; emoji: string }[] = [
  { value: 'icon', label: 'Icon', emoji: '⭐' },
  { value: 'button', label: 'Button', emoji: '🔘' },
  { value: 'badge', label: 'Badge', emoji: '🛡️' },
  { value: 'frame', label: 'Frame', emoji: '🖼️' },
  { value: 'divider', label: 'Divider', emoji: '➖' },
  { value: 'character', label: 'Character', emoji: '🧙' },
  { value: 'background', label: 'Scene', emoji: '🌄' },
];

const ICON_SIZE_OPTIONS: IconSize[] = [16, 32, 48, 64];
const CHARACTER_SIZE_OPTIONS: CharacterSize[] = [256, 512];

const BACKGROUND_PRESETS: { key: string; label: string; width: number; height: number }[] = [
  { key: '1024x576', label: '16:9 small (1024×576)', width: 1024, height: 576 },
  { key: '1280x720', label: '16:9 HD (1280×720)', width: 1280, height: 720 },
  { key: '1920x1080', label: '16:9 Full HD (1920×1080)', width: 1920, height: 1080 },
  { key: '1024x768', label: '4:3 classic (1024×768)', width: 1024, height: 768 },
  { key: '1024x1024', label: 'square (1024×1024)', width: 1024, height: 1024 },
];

const SCALE_OPTIONS = [
  { label: '1x', scale: 1 },
  { label: '2x', scale: 2 },
  { label: '4x', scale: 4 },
];

const PRESET_ICONS = [
  { description: 'home house building', type: 'icon' as const },
  { description: 'gear cog settings', type: 'icon' as const },
  { description: 'left arrow back navigation', type: 'icon' as const },
  { description: 'right arrow forward navigation', type: 'icon' as const },
  { description: 'hamburger menu three lines', type: 'icon' as const },
  { description: 'X close button', type: 'icon' as const },
  { description: 'magnifying glass search', type: 'icon' as const },
  { description: 'green circle online status', type: 'icon' as const },
  { description: 'play triangle button', type: 'icon' as const },
  { description: 'pause two bars button', type: 'icon' as const },
  { description: 'paper airplane send message', type: 'icon' as const },
  { description: 'paperclip attach file', type: 'icon' as const },
  { description: 'microphone audio recording', type: 'icon' as const },
  { description: 'camera photo capture', type: 'icon' as const },
  { description: 'golden sparkle star particle effect', type: 'icon' as const },
  { description: 'ornate RPG decorative corner piece', type: 'frame' as const },
  { description: 'fantasy horizontal divider with gems', type: 'divider' as const },
  { description: 'treasure chest reward badge', type: 'badge' as const },
];

const PALETTE_PRESETS = [
  { name: 'PearlOS', colors: 'indigo, purple, slate, white' },
  { name: 'Retro', colors: 'green, dark green, black, white' },
  { name: 'Sunset', colors: 'orange, pink, purple, dark blue' },
  { name: 'Ocean', colors: 'cyan, blue, navy, white' },
  { name: 'Gold', colors: 'gold, amber, brown, cream' },
];

export default function PixelArtGalleryClient() {
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScale, setSelectedScale] = useState(2);
  const [selectedAsset, setSelectedAsset] = useState<GeneratedAsset | null>(null);

  // Form state
  const [formType, setFormType] = useState<PixelArtType>('icon');
  const [formDescription, setFormDescription] = useState('');
  const [formIconSize, setFormIconSize] = useState<IconSize>(32);
  const [formCharacterSize, setFormCharacterSize] = useState<CharacterSize>(256);
  const [formBackgroundPreset, setFormBackgroundPreset] = useState<string>('1280x720');
  const [formPalette, setFormPalette] = useState('');

  // Load the user's persisted server gallery, falling back to legacy
  // localStorage entries from before the per-user server collection existed.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/pixel-art/list');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.assets)) {
            setAssets(data.assets);
            return;
          }
        }
      } catch {
        // fall back below
      }

      try {
        const saved = localStorage.getItem('pearl-pixel-art-assets');
        if (!saved || cancelled) return;
        const parsed = JSON.parse(saved) as Array<Record<string, unknown>>;
        const migrated: GeneratedAsset[] = parsed.map((a) => {
          if (typeof a.width === 'number' && typeof a.height === 'number') {
            return a as unknown as GeneratedAsset;
          }
          const legacySize = typeof a.size === 'number' ? (a.size as number) : 32;
          return {
            ...(a as object),
            width: legacySize,
            height: legacySize,
          } as unknown as GeneratedAsset;
        });
        setAssets(migrated);
      } catch {
        // ignore
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Save to localStorage when assets change
  useEffect(() => {
    if (assets.length > 0) {
      localStorage.setItem('pearl-pixel-art-assets', JSON.stringify(assets));
    }
  }, [assets]);

  const generateAsset = useCallback(
    async (
      type: PixelArtType,
      description: string,
      sizing: { size?: number; preset?: string; width?: number; height?: number },
      palette?: string,
    ) => {
      setGenerating(true);
      setError(null);

      try {
        const requestBody: Record<string, unknown> = {
          type,
          description,
          palette: palette || undefined,
        };
        if (typeof sizing.size === 'number') requestBody.size = sizing.size;
        if (sizing.preset) requestBody.preset = sizing.preset;
        if (typeof sizing.width === 'number') requestBody.width = sizing.width;
        if (typeof sizing.height === 'number') requestBody.height = sizing.height;

        const res = await fetch('/api/pixel-art/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Generation failed' }));
          throw new Error(errData.error || 'Generation failed');
        }

        const blob = await res.blob();
        const persistedUrl = res.headers.get('x-pixel-art-url');
        const imageUrl = persistedUrl || URL.createObjectURL(blob);

        // Read the actual output dimensions back from response headers so the
        // gallery shows what the server actually produced (presets/explicit
        // width+height/size all flow through here).
        const widthHeader = res.headers.get('x-pixel-art-width');
        const heightHeader = res.headers.get('x-pixel-art-height');
        const width = widthHeader ? parseInt(widthHeader, 10) : sizing.size ?? sizing.width ?? 0;
        const height = heightHeader ? parseInt(heightHeader, 10) : sizing.size ?? sizing.height ?? 0;

        const newAsset: GeneratedAsset = {
          id: res.headers.get('x-pixel-art-id') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          description,
          width,
          height,
          imageUrl,
          timestamp: Date.now(),
        };

        setAssets((prev) => [newAsset, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setGenerating(false);
      }
    },
    [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescription.trim()) return;
    let sizing: { size?: number; preset?: string };
    if (formType === 'character') {
      sizing = { size: formCharacterSize };
    } else if (formType === 'background') {
      sizing = { preset: formBackgroundPreset };
    } else {
      sizing = { size: formIconSize };
    }
    generateAsset(formType, formDescription.trim(), sizing, formPalette);
  };

  const handlePresetClick = (preset: (typeof PRESET_ICONS)[0]) => {
    generateAsset(preset.type, preset.description, { size: 32 }, 'indigo, purple, slate, white');
  };

  const downloadAsset = (asset: GeneratedAsset) => {
    const a = document.createElement('a');
    a.href = asset.imageUrl;
    a.download = `pixel-${asset.type}-${asset.description.replace(/\s+/g, '-').slice(0, 30)}-${asset.width}x${asset.height}.png`;
    a.click();
  };

  const downloadAll = () => {
    assets.forEach((asset, i) => {
      setTimeout(() => downloadAsset(asset), i * 200);
    });
  };

  const deleteAsset = (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    if (selectedAsset?.id === id) setSelectedAsset(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-950 text-slate-100 pixel-grid-bg">
      {/* Header */}
      <header className="border-b border-indigo-500/20 backdrop-blur-xl bg-slate-950/50">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center gap-4">
            <div className="text-4xl animate-float">✨</div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                Pixel Art Gallery
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Generate pixel art — UI icons (16–64px), character sprites (256/512), and full scenes — via OpenRouter
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Generator Panel */}
        <div className="lg:col-span-1 space-y-6">
          {/* Generate Form */}
          <div className="pixel-panel rounded-lg">
            <h2 className="text-lg font-semibold text-indigo-300 mb-4 flex items-center gap-2">
              <span>🎨</span> Generate
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Type Select */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Type</label>
                <div className="flex flex-wrap gap-2">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormType(opt.value)}
                      className={`pixel-btn pixel-btn-sm ${
                        formType === opt.value ? '!border-indigo-400 !bg-indigo-500/30' : ''
                      }`}
                    >
                      {opt.emoji} {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="e.g. golden treasure chest with sparkles"
                  className="w-full px-3 py-2 bg-slate-900/50 border border-indigo-500/20 rounded text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-400/50 resize-none"
                  rows={2}
                />
              </div>

              {/* Size — selector swaps depending on type tier */}
              {ICON_TYPES.includes(formType) ? (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Size (icon)</label>
                  <div className="flex gap-2">
                    {ICON_SIZE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFormIconSize(s)}
                        className={`pixel-btn pixel-btn-sm ${
                          formIconSize === s ? '!border-indigo-400 !bg-indigo-500/30' : ''
                        }`}
                      >
                        {s}px
                      </button>
                    ))}
                  </div>
                </div>
              ) : formType === 'character' ? (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Size (character)</label>
                  <div className="flex gap-2">
                    {CHARACTER_SIZE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFormCharacterSize(s)}
                        className={`pixel-btn pixel-btn-sm ${
                          formCharacterSize === s ? '!border-indigo-400 !bg-indigo-500/30' : ''
                        }`}
                      >
                        {s}×{s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Aspect / Size (scene)</label>
                  <div className="flex flex-wrap gap-2">
                    {BACKGROUND_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setFormBackgroundPreset(p.key)}
                        className={`pixel-btn pixel-btn-sm ${
                          formBackgroundPreset === p.key ? '!border-indigo-400 !bg-indigo-500/30' : ''
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Palette */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Color Palette</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {PALETTE_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setFormPalette(p.colors)}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        formPalette === p.colors
                          ? 'border-indigo-400 bg-indigo-500/20 text-indigo-300'
                          : 'border-slate-700 text-slate-500 hover:border-slate-600'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <input
                  value={formPalette}
                  onChange={(e) => setFormPalette(e.target.value)}
                  placeholder="custom colors..."
                  className="w-full px-3 py-1.5 bg-slate-900/50 border border-indigo-500/20 rounded text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-400/50"
                />
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={generating || !formDescription.trim()}
                className="pixel-btn w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <span className="animate-spin">⚙️</span> Generating...
                  </>
                ) : (
                  <>✨ Generate Pixel Art</>
                )}
              </button>
            </form>

            {error && (
              <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Quick Presets */}
          <div className="pixel-panel rounded-lg">
            <h2 className="text-lg font-semibold text-indigo-300 mb-3 flex items-center gap-2">
              <span>⚡</span> Quick Generate
            </h2>
            <p className="text-xs text-slate-500 mb-3">Click to instantly generate common UI icons</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ICONS.map((preset, i) => (
                <button
                  key={i}
                  onClick={() => handlePresetClick(preset)}
                  disabled={generating}
                  className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:border-indigo-500/50 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
                  title={preset.description}
                >
                  {preset.description.split(' ').slice(0, 2).join(' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Gallery */}
        <div className="lg:col-span-2 space-y-6">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-indigo-300">
                Gallery ({assets.length})
              </h2>
              <div className="flex items-center gap-1 bg-slate-900/50 rounded border border-slate-800 p-0.5">
                {SCALE_OPTIONS.map((opt) => (
                  <button
                    key={opt.scale}
                    onClick={() => setSelectedScale(opt.scale)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      selectedScale === opt.scale
                        ? 'bg-indigo-500/30 text-indigo-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {assets.length > 0 && (
              <button onClick={downloadAll} className="pixel-btn pixel-btn-sm">
                📦 Download All
              </button>
            )}
          </div>

          {/* Asset Grid */}
          {assets.length === 0 ? (
            <div className="pixel-frame rounded-lg text-center py-20">
              <div className="text-6xl mb-4 animate-bob">🎁</div>
              <p className="text-slate-400">No pixel art yet!</p>
              <p className="text-sm text-slate-600 mt-1">
                Generate some icons using the panel on the left
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  className={`pixel-frame rounded-lg p-3 cursor-pointer transition-all hover:pixel-frame-glow animate-chest-open group ${
                    selectedAsset?.id === asset.id ? 'pixel-frame-glow !border-indigo-400/60' : ''
                  }`}
                >
                  <div className="flex items-center justify-center mb-2 min-h-[64px]">
                    {(() => {
                      // Icons get the manual scale (1x/2x/4x). Larger sprites
                      // and wide backgrounds shrink to fit the card.
                      const isIcon = ICON_TYPES.includes(asset.type);
                      const style: React.CSSProperties = isIcon
                        ? {
                            width: `${asset.width * selectedScale}px`,
                            height: `${asset.height * selectedScale}px`,
                          }
                        : {
                            maxWidth: '100%',
                            maxHeight: '160px',
                            width: 'auto',
                            height: 'auto',
                          };
                      return (
                        <img
                          src={asset.imageUrl}
                          alt={asset.description}
                          className="pixel-art"
                          style={style}
                        />
                      );
                    })()}
                  </div>
                  <p className="text-[8px] text-slate-500 text-center truncate">
                    {asset.description}
                  </p>
                  <div className="flex justify-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadAsset(asset);
                      }}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300"
                      title="Download"
                    >
                      💾
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAsset(asset.id);
                      }}
                      className="text-[10px] text-red-400 hover:text-red-300"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Selected Asset Detail */}
          {selectedAsset && (
            <div className="pixel-panel rounded-lg">
              <div className="flex items-start gap-6">
                <div className="flex-shrink-0 pixel-frame rounded-lg p-4 flex items-center justify-center">
                  {(() => {
                    const isIcon = ICON_TYPES.includes(selectedAsset.type);
                    const style: React.CSSProperties = isIcon
                      ? {
                          width: `${selectedAsset.width * 4}px`,
                          height: `${selectedAsset.height * 4}px`,
                        }
                      : {
                          maxWidth: '480px',
                          maxHeight: '320px',
                          width: 'auto',
                          height: 'auto',
                        };
                    return (
                      <img
                        src={selectedAsset.imageUrl}
                        alt={selectedAsset.description}
                        className="pixel-art"
                        style={style}
                      />
                    );
                  })()}
                </div>
                <div className="flex-1 space-y-3">
                  <h3 className="text-sm font-semibold text-indigo-300">
                    {selectedAsset.description}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <span className="pixel-badge">{selectedAsset.type}</span>
                    <span className="pixel-badge">{selectedAsset.width}×{selectedAsset.height}</span>
                  </div>

                  {/* Multi-scale preview — only meaningful for tiny icon sprites */}
                  {ICON_TYPES.includes(selectedAsset.type) && (
                    <div>
                      <p className="text-xs text-slate-500 mb-2">Scale preview</p>
                      <div className="flex items-end gap-4">
                        {[1, 2, 4, 8].map((scale) => (
                          <div key={scale} className="text-center">
                            <img
                              src={selectedAsset.imageUrl}
                              alt=""
                              className="pixel-art mx-auto"
                              style={{
                                width: `${selectedAsset.width * scale}px`,
                                height: `${selectedAsset.height * scale}px`,
                              }}
                            />
                            <span className="text-[8px] text-slate-600 mt-1 block">{scale}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => downloadAsset(selectedAsset)}
                      className="pixel-btn pixel-btn-sm pixel-btn-success"
                    >
                      💾 Download
                    </button>
                    <button
                      onClick={() => {
                        deleteAsset(selectedAsset.id);
                      }}
                      className="pixel-btn pixel-btn-sm pixel-btn-danger"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
