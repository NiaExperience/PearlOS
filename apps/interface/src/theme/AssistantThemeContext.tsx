"use client";
import React, { createContext, useContext, useMemo } from 'react';
import { AssistantThemeBlock } from '@nia/prism/core/blocks';

export interface ThemeTokens {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  textPrimary: string;
  textSecondary: string;
  textAccent: string;
}

interface AssistantThemeContextValue {
  raw: AssistantThemeBlock.IAssistantTheme | undefined;
  tokens: ThemeTokens;
}

const AssistantThemeContext = createContext<AssistantThemeContextValue | undefined>(undefined);

const DEFAULT_THEME_TOKENS: ThemeTokens = {
  primary: '#7DD3FC',
  secondary: '#38BDF8',
  accent: '#BAE6FD',
  background: '#020817',
  textPrimary: '#F8FAFC',
  textSecondary: '#D6E4F0',
  textAccent: '#93C5FD',
};

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const convert = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * convert(rgb.r) + 0.7152 * convert(rgb.g) + 0.0722 * convert(rgb.b);
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);

  if (foregroundLuminance === null || backgroundLuminance === null) return 0;

  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableColor(value: unknown, fallback: string, background: string, minimumContrast = 4.5) {
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  return contrastRatio(trimmed, background) >= minimumContrast ? trimmed : fallback;
}

export const AssistantThemeProvider: React.FC<{
  theme: AssistantThemeBlock.IAssistantTheme | undefined;
  children: React.ReactNode;
}> = ({ theme, children }) => {
  const tokens: ThemeTokens = useMemo(() => {
    const colors = theme?.theme_config?.colors || {} as any;
    const background = readableColor(colors.background, DEFAULT_THEME_TOKENS.background, '#FFFFFF', 7);

    return {
      primary: readableColor(colors.primary, DEFAULT_THEME_TOKENS.primary, background),
      secondary: readableColor(colors.secondary, DEFAULT_THEME_TOKENS.secondary, background),
      accent: readableColor(colors.accent, DEFAULT_THEME_TOKENS.accent, background),
      background,
      textPrimary: readableColor(colors.text?.primary, DEFAULT_THEME_TOKENS.textPrimary, background, 7),
      textSecondary: readableColor(colors.text?.secondary, DEFAULT_THEME_TOKENS.textSecondary, background, 4.5),
      textAccent: readableColor(colors.text?.accent, DEFAULT_THEME_TOKENS.textAccent, background, 4.5),
    };
  }, [theme]);

  return (
    <AssistantThemeContext.Provider value={{ raw: theme, tokens }}>
      <div
        style={{
          // Expose vars for tailwind arbitrary value usage
          ['--theme-primary' as any]: tokens.primary,
          ['--theme-secondary' as any]: tokens.secondary,
          ['--theme-accent' as any]: tokens.accent,
          ['--theme-background' as any]: tokens.background,
          ['--theme-text-primary' as any]: tokens.textPrimary,
          ['--theme-text-secondary' as any]: tokens.textSecondary,
          ['--theme-text-accent' as any]: tokens.textAccent,
        }}
        className="contents"
      >
        {children}
      </div>
    </AssistantThemeContext.Provider>
  );
};

export function useAssistantTheme() {
  const ctx = useContext(AssistantThemeContext);
  if (!ctx) throw new Error('useAssistantTheme must be used within AssistantThemeProvider');
  return ctx;
}
