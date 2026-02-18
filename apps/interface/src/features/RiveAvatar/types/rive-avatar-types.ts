export interface RiveAvatarProps {
  className?: string;
  supportedFeatures?: string[];
}

// Animation stage constants
export const STAGE = {
  STARTING: 0,
  RELAXED_SPEAKING: 1,
  BROWSER_EXPLANATION: 2,
  CALL_ENDING: 3
} as const;

export type Stage = typeof STAGE[keyof typeof STAGE];

// Animation values for relaxed mode
export const RELAXED_STAGE_VALUES = {
  IDLE: 0.33,      // Changed from 0 to 0.33 to use a better idle animation
  SMILE_BASIC: 0.5, // Adjusted to avoid conflicts with idle
  RELAX_TALK: 0.66,
  TALKING: 1
} as const;

// Animation values for browser mode
export const BROWSER_STAGE_VALUES = {
  IDLE: 0,
  RELAX_TALK: 0.33,
  LOOKS_LEFT: 0.66,
  TALKS_WHILE_LOOKING_LEFT: 1
} as const;

// Rive state machine configuration
export interface RiveConfig {
  stateMachineName: string;
  src: string;
  autoplay: boolean;
  // rive-react expects `stateMachines` to initialize the state machine(s)
  stateMachines?: string | string[];
  inputs: {
    stage: string;
    relaxStageValue: string;
    lookLeftValue: string;
  };
}

export const DEFAULT_RIVE_CONFIG: RiveConfig = {
  stateMachineName: "Avatar Transition",
  src: "/master_pearl3.riv",
  autoplay: true,
  stateMachines: "Avatar Transition",
  inputs: {
    stage: "stage",
    relaxStageValue: "relax_stage_value",
    lookLeftValue: "look_left_value"
  }
};
