export enum DesktopMode {
  HOME = 'home',
  WORK = 'work',
  DESKTOP = 'desktop',
  QUIET = 'quiet',
  CREATIVE = 'creative',
  FOCUS = 'focus',
  RELAXATION = 'relaxation',
  GAMING = 'gaming',
  DEFAULT = 'default',
}

export interface DesktopModeConfig {
  mode: DesktopMode;
  name: string;
  description: string;
  icon: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export interface DesktopModeSwitchPayload {
  targetMode: DesktopMode;
  previousMode?: DesktopMode | null;
  switchReason: string;
}

export interface DesktopModeSwitchResponse {
  success: boolean;
  mode: DesktopMode;
  message: string;
  userRequest?: string | null;
  timestamp: string;
  action: 'SWITCH_DESKTOP_MODE';
  payload: DesktopModeSwitchPayload;
}

export const DESKTOP_MODE_CONFIGS: Record<DesktopMode, DesktopModeConfig> = {
  [DesktopMode.HOME]: {
    mode: DesktopMode.HOME,
    name: 'Home',
    description: 'Comfortable and relaxed environment',
    icon: '🏠',
    colors: {
      primary: '#4F46E5',
      secondary: '#818CF8',
      accent: '#C7D2FE'
    }
  },
  [DesktopMode.WORK]: {
    mode: DesktopMode.WORK,
    name: 'Work',
    description: 'Focused productivity layout for tasks and projects',
    icon: '🧰',
    colors: {
      primary: '#0F766E',
      secondary: '#2DD4BF',
      accent: '#99F6E4'
    }
  },
  [DesktopMode.DESKTOP]: {
    mode: DesktopMode.DESKTOP,
    name: 'Desktop',
    description: 'Professional and productive environment',
    icon: '💼',
    colors: {
      primary: '#059669',
      secondary: '#34D399',
      accent: '#A7F3D0'
    }
  },
  [DesktopMode.QUIET]: {
    mode: DesktopMode.QUIET,
    name: 'Quiet',
    description: 'Minimal, low-distraction surface for reading and thinking',
    icon: '🌙',
    colors: {
      primary: '#1E293B',
      secondary: '#475569',
      accent: '#CBD5E1'
    }
  },
  [DesktopMode.CREATIVE]: {
    mode: DesktopMode.CREATIVE,
    name: 'Creative',
    description: 'Studio mode tuned for builds, sprites, and creative play',
    icon: '🎨',
    colors: {
      primary: '#9333EA',
      secondary: '#C084FC',
      accent: '#E9D5FF'
    }
  },
  [DesktopMode.FOCUS]: {
    mode: DesktopMode.FOCUS,
    name: 'Focus',
    description: 'Deep-work surface, distractions hidden',
    icon: '🎯',
    colors: {
      primary: '#0369A1',
      secondary: '#38BDF8',
      accent: '#BAE6FD'
    }
  },
  [DesktopMode.RELAXATION]: {
    mode: DesktopMode.RELAXATION,
    name: 'Relax',
    description: 'Calm ambient surface for unwinding',
    icon: '🌿',
    colors: {
      primary: '#15803D',
      secondary: '#4ADE80',
      accent: '#BBF7D0'
    }
  },
  [DesktopMode.GAMING]: {
    mode: DesktopMode.GAMING,
    name: 'Gaming',
    description: 'Playful surface for arcade and game launches',
    icon: '🎮',
    colors: {
      primary: '#BE123C',
      secondary: '#FB7185',
      accent: '#FECDD3'
    }
  },
  [DesktopMode.DEFAULT]: {
    mode: DesktopMode.DEFAULT,
    name: 'Default',
    description: 'Fallback surface used before a mode has been chosen',
    icon: '🖥️',
    colors: {
      primary: '#475569',
      secondary: '#94A3B8',
      accent: '#E2E8F0'
    }
  }
};
