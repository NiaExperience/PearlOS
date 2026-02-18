import { WindowLayout } from '../types/maneuverable-window-types';

export interface KeyboardHandlersConfig {
    onSetVisible: (isVisible: boolean) => void;
    onSetLayout: (layout: WindowLayout | ((prev: WindowLayout) => WindowLayout)) => void;
    onMinimize: () => void;
}

export function registerManeuverableWindowShortcuts(config: KeyboardHandlersConfig) {
    const handler = (e: KeyboardEvent) => {
        if (!(e.ctrlKey && e.shiftKey)) return;
        const key = e.key;
        switch (key) {
            case 'F':
            case 'f':
                e.preventDefault();
                config.onSetVisible(true);
                config.onSetLayout(prev => (prev === 'maximized' ? 'normal' : 'maximized'));
                return;
            case 'M':
            case 'm':
                e.preventDefault();
                config.onMinimize();
                return;
            case 'ArrowLeft':
                e.preventDefault();
                config.onSetVisible(true);
                config.onSetLayout('left');
                return;
            case 'ArrowRight':
                e.preventDefault();
                config.onSetVisible(true);
                config.onSetLayout('right');
                return;
            case 'ArrowDown':
                e.preventDefault();
                config.onSetVisible(true);
                config.onSetLayout('normal');
                return;
            case 'ArrowUp':
                e.preventDefault();
                config.onSetVisible(true);
                config.onSetLayout('maximized');
                return;
            default:
                return;
        }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
}


