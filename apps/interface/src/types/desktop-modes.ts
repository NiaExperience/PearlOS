export enum DesktopMode {
  DEFAULT = 'default',
  HOME = 'home',
  WORK = 'work',
  CREATIVE = 'creative',
  GAMING = 'gaming',
  FOCUS = 'focus',
  RELAXATION = 'relaxation',
  QUIET = 'quiet',
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
  [DesktopMode.DEFAULT]: {
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
    description: 'Professional and productive environment',
    icon: '💼',
    colors: {
      primary: '#059669',
      secondary: '#34D399',
      accent: '#A7F3D0'
    }
  },
  [DesktopMode.CREATIVE]: {
    mode: DesktopMode.CREATIVE,
    name: 'Creative',
    description: 'Inspiring and artistic environment',
    icon: '🎨',
    colors: {
      primary: '#DC2626',
      secondary: '#F87171',
      accent: '#FECACA'
    }
  },
  [DesktopMode.GAMING]: {
    mode: DesktopMode.GAMING,
    name: 'Gaming',
    description: 'High-energy gaming environment',
    icon: '🎮',
    colors: {
      primary: '#7C3AED',
      secondary: '#A78BFA',
      accent: '#DDD6FE'
    }
  },
  [DesktopMode.FOCUS]: {
    mode: DesktopMode.FOCUS,
    name: 'Focus',
    description: 'Minimal and distraction-free environment',
    icon: '🎯',
    colors: {
      primary: '#374151',
      secondary: '#6B7280',
      accent: '#D1D5DB'
    }
  },
  [DesktopMode.RELAXATION]: {
    mode: DesktopMode.RELAXATION,
    name: 'Relaxation',
    description: 'Calm and peaceful environment',
    icon: '🧘',
    colors: {
      primary: '#0891B2',
      secondary: '#22D3EE',
      accent: '#A5F3FC'
    }
  },
  [DesktopMode.QUIET]: {
    mode: DesktopMode.QUIET,
    name: 'Quiet',
    description: 'Personal, peaceful retreat',
    icon: '🌿',
    colors: {
      primary: '#6B7280',
      secondary: '#94A3B8',
      accent: '#CBD5F5'
    }
  }
}; 