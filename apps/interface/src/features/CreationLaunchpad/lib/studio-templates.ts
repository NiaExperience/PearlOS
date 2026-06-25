import type { AgencyProjectType } from './agency-coordinator';
import type { AgencyRoomKey } from '@interface/features/TaskVisualization/PearlAgencyRooms';

export type StudioTemplateCategory = 'app' | 'game' | 'pearlos' | 'our-pearlos';
export type StudioTemplateMode = Extract<AgencyProjectType, 'app' | 'game' | 'pearlos'>;

export interface StudioTemplate {
  id: string;
  category: StudioTemplateCategory;
  title: string;
  summary: string;
  prompt: string;
  creationType: StudioTemplateMode;
  room: AgencyRoomKey;
}

export const STUDIO_SWARM_TEMPLATES: readonly StudioTemplate[] = [
  {
    id: 'app-single-button',
    category: 'app',
    title: 'Single Button App',
    summary: 'A tiny app with one polished action button.',
    creationType: 'app',
    room: 'code',
    prompt:
      'Build a tiny PearlOS app with one clear button. The button should update a status line and feel finished enough to install as a personal app.',
  },
  {
    id: 'app-habit-tile',
    category: 'app',
    title: 'Habit Tile',
    summary: 'A compact daily tracker with one saved count.',
    creationType: 'app',
    room: 'generic',
    prompt:
      'Create a compact habit tracker tile for PearlOS. It needs one habit name, one count button, and a calm empty state.',
  },
  {
    id: 'game-tap-target',
    category: 'game',
    title: 'Tap Target',
    summary: 'A fast touch-friendly target game.',
    creationType: 'game',
    room: 'creative',
    prompt:
      'Make a simple tap-target game for PearlOS. Show a score, a timer, one moving target, and a clear replay button.',
  },
  {
    id: 'game-one-button-catch',
    category: 'game',
    title: 'One Button Catch',
    summary: 'A one-control arcade loop.',
    creationType: 'game',
    room: 'code',
    prompt:
      'Build a one-button catch game. The player taps one control to catch falling items, with score, miss count, and restart.',
  },
  {
    id: 'pearlos-theme-pack',
    category: 'pearlos',
    title: 'Theme Pack',
    summary: 'A personal theme proposal users can review.',
    creationType: 'pearlos',
    room: 'design',
    prompt:
      'Draft a personal PearlOS theme pack: colors for desktop, windows, and buttons, plus a preview card. Keep it installable only for my account.',
  },
  {
    id: 'pearlos-desktop-button',
    category: 'pearlos',
    title: 'Desktop Button',
    summary: 'A safe single-icon desktop shortcut.',
    creationType: 'pearlos',
    room: 'strategy',
    prompt:
      'Create a personal PearlOS desktop button proposal. It should define the label, icon, action, and install notes without changing global source.',
  },
  {
    id: 'our-pearlos-shared-theme',
    category: 'our-pearlos',
    title: 'Shared Theme Install',
    summary: 'Try the shared-feature add flow.',
    creationType: 'pearlos',
    room: 'design',
    prompt:
      'Package a simple shared PearlOS theme from another user into an install preview for my account. Show what will change and how to undo it.',
  },
  {
    id: 'our-pearlos-shared-button',
    category: 'our-pearlos',
    title: 'Shared Quick Button',
    summary: 'Install a community one-button feature.',
    creationType: 'pearlos',
    room: 'strategy',
    prompt:
      'Package a community shared quick button for my PearlOS desktop. Include the button label, icon, action, and a personal-only install plan.',
  },
];

export const STUDIO_TEMPLATE_GROUPS: ReadonlyArray<{
  id: StudioTemplateCategory;
  label: string;
}> = [
  { id: 'app', label: 'App' },
  { id: 'game', label: 'Game' },
  { id: 'pearlos', label: 'PearlOS' },
  { id: 'our-pearlos', label: 'Our PearlOS' },
];
