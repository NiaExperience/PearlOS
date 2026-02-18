"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { ManeuverableWindowState, WindowLayout } from '../types/maneuverable-window-types';

interface ManeuverableWindowContextType extends ManeuverableWindowState {
    setIsVisible: (v: boolean) => void;
    setWasMinimized: (v: boolean) => void;
    setWindowLayout: (l: WindowLayout | ((prev: WindowLayout) => WindowLayout)) => void;
}

const ManeuverableWindowContext = createContext<ManeuverableWindowContextType | undefined>(undefined);

export function ManeuverableWindowProvider({ children }: { children: ReactNode }) {
    const [isVisible, setIsVisible] = useState<boolean>(false);
    const [wasMinimized, setWasMinimized] = useState<boolean>(false);
    const [windowLayout, setWindowLayout] = useState<WindowLayout>('normal');

    return (
        <ManeuverableWindowContext.Provider value={{ isVisible, wasMinimized, windowLayout, setIsVisible, setWasMinimized, setWindowLayout }}>
            {children}
        </ManeuverableWindowContext.Provider>
    );
}

export function useManeuverableWindow() {
    const ctx = useContext(ManeuverableWindowContext);
    if (!ctx) throw new Error('useManeuverableWindow must be used within ManeuverableWindowProvider');
    return ctx;
}