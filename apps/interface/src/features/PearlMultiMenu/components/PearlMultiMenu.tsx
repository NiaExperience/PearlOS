'use client';

import { PersonalityVoiceConfig } from '@nia/prism/core/blocks/assistant.block';
import React, { useCallback, useState, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useRive, useStateMachineInput } from 'rive-react';
import { usePostHog } from 'posthog-js/react';

import { PersonalitySelector } from '@interface/components/personality-selector';

interface PearlMultiMenuProps {
  className?: string;
  onButtonClick?: () => void;
  onIconClick?: (iconType: string) => void;
  onMenuStateChange?: (isRevealed: boolean) => void; // Callback for menu state changes
  onPointerEnter?: () => void; // Fired when pointer enters the interactive menu area
  onPointerLeave?: () => void; // Fired when pointer exits the interactive menu area
  onPersonalityChange?: (config: PersonalityVoiceConfig) => void; // Callback when personality is selected
  rivFile?: string; // Optional Rive file path (defaults to pearlmenu3.riv)
  allowedPersonalities?: Record<string, PersonalityVoiceConfig>; // Map of personality configs
  currentPersonalityKey?: string; // Currently selected personality composite key (name-provider-voiceId)
}

export interface PearlMultiMenuRef {
  triggerAnimation: () => void;
  hideAnimation: () => void;
}

export const PearlMultiMenu = forwardRef<PearlMultiMenuRef, PearlMultiMenuProps>(({
  className = '',
  onButtonClick,
  onIconClick,
  onMenuStateChange,
  onPointerEnter,
  onPointerLeave,
  onPersonalityChange,
  rivFile = '/pearlmenu3.riv',
  allowedPersonalities = {},
  currentPersonalityKey
}, ref) => {
  const posthog = usePostHog();
  const [isButtonsRevealed, setIsButtonsRevealed] = useState<boolean>(false);
  const [showPersonalitySelector, setShowPersonalitySelector] = useState<boolean>(false);

  // Load the specified Rive file with the pearlmultimenu state machine
  const { rive, RiveComponent } = useRive({
    src: rivFile,
    stateMachines: 'pearlmultimenu',
    autoplay: true,
  });

  // Access the single trigger that actually exists in the state machine
  const buttonsRevealTrigger = useStateMachineInput(rive, 'pearlmultimenu', 'Buttons Reveal');

  // Handle button click to toggle using the single trigger
  const handleClick = useCallback(() => {
    if (!buttonsRevealTrigger) {
      return;
    }

    // Fire the single trigger - the state machine should handle the toggle internally
    try {
      buttonsRevealTrigger.fire();
      // Toggle our local state to keep track
      const newState = !isButtonsRevealed;
      setIsButtonsRevealed(newState);
      posthog?.capture('menu_state_changed', { revealed: newState });

      // Notify parent of state change
      if (onMenuStateChange) {
        onMenuStateChange(newState);
      }
    } catch (error) {
      // Silent error handling
    }

    // Call the optional callback
    if (onButtonClick) {
      onButtonClick();
    }
  }, [buttonsRevealTrigger, isButtonsRevealed, onButtonClick, onMenuStateChange]);

  // Handle forced hide animation
  const handleHide = useCallback(() => {
    if (!buttonsRevealTrigger) {
      return;
    }

    // Only fire the trigger if buttons are currently revealed
    if (isButtonsRevealed) {
      try {
        buttonsRevealTrigger.fire();
        setIsButtonsRevealed(false);

        // Notify parent of state change
        if (onMenuStateChange) {
          onMenuStateChange(false);
        }
      } catch (error) {
        // Silent error handling
      }
    }
  }, [buttonsRevealTrigger, isButtonsRevealed, onMenuStateChange]);

  // Handle icon clicks
  const handleIconClick = useCallback((iconType: string, event: React.MouseEvent) => {
    // Prevent event from bubbling to parent elements
    event.stopPropagation();

    // Only handle Talk icon (top-right) - show personality selector
    if (iconType === 'top-right') {
      setShowPersonalitySelector(true);
      posthog?.capture('personality_selector_opened');

      // Call the callback if provided
      if (onIconClick) {
        onIconClick(iconType);
      }

      // Hide the menu after icon click
      if (isButtonsRevealed) {
        handleHide();
      }
    }
    // All other icons are inactive - do nothing
  }, [onIconClick, isButtonsRevealed, handleHide]);

  // Handle personality selection
  const handlePersonalitySelect = useCallback((config: PersonalityVoiceConfig) => {
    if (onPersonalityChange) {
      onPersonalityChange(config);
    }
  }, [onPersonalityChange]);

  // Effect to monitor Rive loading and state machine inputs
  useEffect(() => {
    // Rive animation loaded and trigger ready
  }, [rive, buttonsRevealTrigger]);

  // Expose the click handler to parent components
  useImperativeHandle(ref, () => ({
    triggerAnimation: handleClick,
    hideAnimation: handleHide
  }), [handleClick, handleHide]);

  return (
    <div
      className={`pearl-multi-menu ${className}`}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '500%', // Make container much larger to scale up the plus icon
        height: '500%', // Make container much larger to scale up the plus icon
        zIndex: 1, // Behind the main pearl animation
        pointerEvents: 'none', // Keep container non-interactive
      }}
    >
      {RiveComponent && (
        <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}>
          <RiveComponent
            className="w-full h-full"
            style={{
              backgroundColor: 'transparent',
              background: 'none',
              transform: 'scale(1.0)',
              pointerEvents: 'none', // Disable pointer events on the Rive canvas
            }}
          />

          {/* Note: Center button clicking is handled by the parent AssistantButton component, not here */}

          {/* Clickable areas for each icon - Only Talk icon (top-right) is active */}
          {isButtonsRevealed && (
            <div
              className="absolute inset-0"
              style={{ pointerEvents: 'auto' }}
              onMouseEnter={() => onPointerEnter?.()}
              onMouseLeave={() => onPointerLeave?.()}
            >
               {/* Top icon - Inactive */}
               <div
                 className="absolute"
                 style={{
                   top: '32%',
                   left: '50%',
                   width: '10%',
                   height: '10%',
                   backgroundColor: 'transparent',
                   borderRadius: '50%',
                   transform: 'translate(-50%, -50%)',
                   pointerEvents: 'none', // Inactive
                   opacity: 0.3,
                 }}
                 title="Chat/Message (Coming Soon)"
               />

               {/* Top-right icon - Talk icon (ACTIVE) */}
               <div
                 className="absolute cursor-pointer"
                 style={{
                   top: '45%',
                   left: '66%',
                   width: '10%',
                   height: '10%',
                   backgroundColor: 'transparent',
                   borderRadius: '50%',
                   transform: 'translate(-50%, -50%)',
                   pointerEvents: 'auto', // Active
                 }}
                 onClick={(e) => handleIconClick('top-right', e)}
                 title="Talk - Select Personality"
               />

               {/* Bottom-right icon - Inactive */}
               <div
                 className="absolute"
                 style={{
                   top: '64%',
                   left: '60%',
                   width: '10%',
                   height: '10%',
                   backgroundColor: 'transparent',
                   borderRadius: '50%',
                   transform: 'translate(-50%, -50%)',
                   pointerEvents: 'none', // Inactive
                   opacity: 0.3,
                 }}
                 title="Eyes/Vision (Coming Soon)"
               />

               {/* Bottom-left icon - Inactive */}
               <div
                 className="absolute"
                 style={{
                   top: '64%',
                   left: '40%',
                   width: '10%',
                   height: '10%',
                   backgroundColor: 'transparent',
                   borderRadius: '50%',
                   transform: 'translate(-50%, -50%)',
                   pointerEvents: 'none', // Inactive
                   opacity: 0.3,
                 }}
                 title="Question/Help (Coming Soon)"
               />

               {/* Top-left icon - Inactive */}
               <div
                 className="absolute"
                 style={{
                   top: '45%',
                   left: '34%',
                   width: '10%',
                   height: '10%',
                   backgroundColor: 'transparent',
                   borderRadius: '50%',
                   transform: 'translate(-50%, -50%)',
                   pointerEvents: 'none', // Inactive
                   opacity: 0.3,
                 }}
                 title="Sleep/Moon (Coming Soon)"
               />
            </div>
          )}
        </div>
      )}

      {/* Personality Selector Modal */}
      <PersonalitySelector
        open={showPersonalitySelector}
        onOpenChange={setShowPersonalitySelector}
        allowedPersonalities={allowedPersonalities}
        currentPersonalityKey={currentPersonalityKey}
        onSelectPersonality={handlePersonalitySelect}
      />
    </div>
  );
});

PearlMultiMenu.displayName = 'PearlMultiMenu';

export default PearlMultiMenu;
