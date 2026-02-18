"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WindowLayout } from '../types/maneuverable-window-types';
import Image from 'next/image';

interface ControlsProps {
    layout: WindowLayout;
    onLayoutChange: (layout: WindowLayout) => void;
    onMinimize: () => void;
    onClose: () => void;
    onRestoreCenter: () => void;
}

export function ManeuverableWindowControls({ layout, onLayoutChange, onMinimize, onClose, onRestoreCenter }: ControlsProps) {
    const [controlsVisible, setControlsVisible] = useState(true);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const controlsContainerRef = useRef<HTMLDivElement>(null);
    const HIDE_DELAY = 3000; // 3 seconds

    // Detect mobile device
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 768; // Tailwind's md breakpoint
            setIsMobile(mobile);
            // On mobile, start with controls hidden
            if (mobile) {
                setControlsVisible(false);
            }
        };
        
        checkMobile();
        window.addEventListener('resize', checkMobile);
        
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const resetHideTimer = useCallback(() => {
        if (hideTimeoutRef.current) {
            clearTimeout(hideTimeoutRef.current);
        }
        setControlsVisible(true);
        // Don't auto-hide if dropdown is open
        if (isDropdownOpen) return;
        hideTimeoutRef.current = setTimeout(() => {
            setControlsVisible(false);
        }, HIDE_DELAY);
    }, [HIDE_DELAY, isDropdownOpen]);

    // Helper function to check if an element is interactive
    const isInteractiveElement = useCallback((element: HTMLElement | null): boolean => {
        if (!element) return false;
        
        // Check if element is a button, input, select, textarea, or anchor
        const tagName = element.tagName.toLowerCase();
        if (['button', 'input', 'select', 'textarea', 'a'].includes(tagName)) {
            return true;
        }
        
        // Check if element has role="button" or other interactive roles
        const role = element.getAttribute('role');
        if (role && ['button', 'link', 'tab', 'menuitem', 'option'].includes(role)) {
            return true;
        }
        
        // Check if element has onClick handler or is clickable
        if (element.onclick || element.getAttribute('onclick')) {
            return true;
        }
        
        // Check if element has cursor: pointer style
        const computedStyle = window.getComputedStyle(element);
        if (computedStyle.cursor === 'pointer') {
            return true;
        }
        
        return false;
    }, []);

    // Listen for dropdown state changes from HtmlContentViewer
    useEffect(() => {
        const handleDropdownStateChange = (e: Event) => {
            const customEvent = e as CustomEvent<{ isDropdownOpen: boolean }>;
            const newDropdownState = customEvent.detail?.isDropdownOpen ?? false;
            setIsDropdownOpen(newDropdownState);
            
            // If dropdown opens, force controls to be visible
            if (newDropdownState) {
                setControlsVisible(true);
                if (hideTimeoutRef.current) {
                    clearTimeout(hideTimeoutRef.current);
                }
            }
            // If dropdown just closed, restart the hide timer
            else {
                resetHideTimer();
            }
        };

        window.addEventListener('htmlViewer.dropdownStateChange', handleDropdownStateChange);
        
        return () => {
            window.removeEventListener('htmlViewer.dropdownStateChange', handleDropdownStateChange);
        };
    }, [resetHideTimer]);

    // Handle mouse movement and window focus/blur (desktop)
    // Handle touch/click events (mobile)
    useEffect(() => {
        // Find the browser window container
        const browserWindow = document.querySelector('[class*="border"][class*="rounded-xl"][class*="overflow-hidden"]');
        if (!browserWindow) return;

        const handleMouseMove = () => {
            if (!isMobile) {
                resetHideTimer();
            }
        };

        const handleMouseLeave = () => {
            if (isMobile) return; // Skip on mobile
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
            // Don't hide if dropdown is open
            if (isDropdownOpen) return;
            setControlsVisible(false);
        };

        const handleMouseEnter = () => {
            if (!isMobile) {
                resetHideTimer();
            }
        };

        const handleWindowBlur = () => {
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
            // Don't hide if dropdown is open
            if (isDropdownOpen) return;
            setControlsVisible(false);
        };

        const handleWindowFocus = () => {
            if (!isMobile) {
                resetHideTimer();
            }
        };

        // Mobile: Handle touch/click events to show controls
        const handleTouchStart = (e: Event) => {
            if (isMobile) {
                const touchEvent = e as TouchEvent;
                // Don't show controls if clicking on the controls themselves
                const target = touchEvent.target as HTMLElement;
                if (controlsContainerRef.current && controlsContainerRef.current.contains(target)) {
                    return;
                }
                
                // Check if target is an interactive element
                const isInteractive = isInteractiveElement(target);
                const INTERACTIVE_DELAY = 500; // 500ms delay for interactive elements
                
                if (isInteractive) {
                    // Delay showing controls for interactive elements to allow their action to complete
                    setTimeout(() => {
                        resetHideTimer();
                    }, INTERACTIVE_DELAY);
                } else {
                    // Show controls immediately for non-interactive areas
                    resetHideTimer();
                }
            }
        };

        const handleClick = (e: Event) => {
            if (isMobile) {
                const mouseEvent = e as MouseEvent;
                // Don't show controls if clicking on the controls themselves
                const target = mouseEvent.target as HTMLElement;
                if (controlsContainerRef.current && controlsContainerRef.current.contains(target)) {
                    return;
                }
                
                // Check if target is an interactive element
                const isInteractive = isInteractiveElement(target);
                const INTERACTIVE_DELAY = 500; // 500ms delay for interactive elements
                
                if (isInteractive) {
                    // Delay showing controls for interactive elements to allow their action to complete
                    setTimeout(() => {
                        resetHideTimer();
                    }, INTERACTIVE_DELAY);
                } else {
                    // Show controls immediately for non-interactive areas
                    resetHideTimer();
                }
            }
        };

        // Add event listeners to the browser window container
        browserWindow.addEventListener('mousemove', handleMouseMove);
        browserWindow.addEventListener('mouseleave', handleMouseLeave);
        browserWindow.addEventListener('mouseenter', handleMouseEnter);
        
        // Mobile: Add touch and click listeners
        browserWindow.addEventListener('touchstart', handleTouchStart, { passive: true });
        browserWindow.addEventListener('click', handleClick);
        
        // Window focus/blur for when user switches windows/apps
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('focus', handleWindowFocus);
        
        // Start initial timer (only for desktop)
        if (!isMobile) {
            resetHideTimer();
        }

        return () => {
            browserWindow.removeEventListener('mousemove', handleMouseMove);
            browserWindow.removeEventListener('mouseleave', handleMouseLeave);
            browserWindow.removeEventListener('mouseenter', handleMouseEnter);
            browserWindow.removeEventListener('touchstart', handleTouchStart);
            browserWindow.removeEventListener('click', handleClick);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('focus', handleWindowFocus);
            if (hideTimeoutRef.current) {
                clearTimeout(hideTimeoutRef.current);
            }
        };
    }, [resetHideTimer, isDropdownOpen, isMobile, isInteractiveElement]);

    return (
        <div 
            ref={controlsContainerRef}
            className={`absolute top-1.5 right-1.5 z-50 flex items-center gap-2 transition-all duration-300 ease-in-out ${
                controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
        >
            {isMobile ? (
                // Mobile: Show only Close button
                <button
                    onClick={onClose}
                    className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                    title="Close"
                >
                    <Image 
                        src="/windowcontrolicons/close.png" 
                        alt="Close" 
                        width={16} 
                        height={16}
                        style={{ imageRendering: 'pixelated' }}
                    />
                </button>
            ) : (
                // Desktop: Show all controls
                <>
                    <button
                        onClick={() => { onLayoutChange('left'); }}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title="Snap Left"
                    >
                        <Image 
                            src="/windowcontrolicons/snapleft.png" 
                            alt="Snap Left" 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                    <button
                        onClick={() => { onLayoutChange('right'); }}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title="Snap Right"
                    >
                        <Image 
                            src="/windowcontrolicons/snapright.png" 
                            alt="Snap Right" 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                    <button
                        onClick={() => { onRestoreCenter(); }}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title="Center"
                    >
                        <Image 
                            src="/windowcontrolicons/center.png" 
                            alt="Center" 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                    <button
                        onClick={onMinimize}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title="Minimize"
                    >
                        <Image 
                            src="/windowcontrolicons/minimize.png" 
                            alt="Minimize" 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                    <button
                        onClick={() => onLayoutChange(layout === 'maximized' ? 'normal' : 'maximized')}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title={layout === 'maximized' ? 'Restore' : 'Maximize'}
                    >
                        <Image 
                            src={layout === 'maximized' ? '/windowcontrolicons/restore.png' : '/windowcontrolicons/maximize.png'} 
                            alt={layout === 'maximized' ? 'Restore' : 'Maximize'} 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1 bg-gray-600/80 hover:bg-gray-500/90 text-white border border-gray-500/50 hover:border-gray-400/70 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl backdrop-blur-md hover:backdrop-blur-lg"
                        title="Close"
                    >
                        <Image 
                            src="/windowcontrolicons/close.png" 
                            alt="Close" 
                            width={16} 
                            height={16}
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </button>
                </>
            )}
        </div>
    );
}