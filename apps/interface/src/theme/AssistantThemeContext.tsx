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

export const AssistantThemeProvider: React.FC<{
  theme: AssistantThemeBlock.IAssistantTheme | undefined;
  children: React.ReactNode;
}> = ({ theme, children }) => {
  const tokens: ThemeTokens = useMemo(() => {
    const colors = theme?.theme_config?.colors || {} as any;
    return {
      primary: colors.primary || '#8EC6FF',
      secondary: colors.secondary || '#FFDA77',
      accent: colors.accent || '#FFD700',
      background: colors.background || '#000000',
      textPrimary: colors.text?.primary || '#ffffff',
      textSecondary: colors.text?.secondary || '#6b7280',
      textAccent: colors.text?.accent || '#2563eb',
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
