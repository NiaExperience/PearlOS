import { useEffect, useState, useCallback } from 'react';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';

export interface AnimationState {
	shouldShowTalkingAnimation: boolean; // Controls talking animations
	forceStopAnimation: boolean; // Force stop any mouth movement
	animationType: 'talking' | 'listening' | 'idle' | 'frozen';
	intensity: number;
	isUserDominant: boolean; // True when user is speaking
	animationName: string; // Exact animation name to use
}

export const useAnimationControl = () => {
	const { 
		isAssistantSpeaking, 
		isUserSpeaking, 
		assistantVolumeLevel,
		audioLevel,
		canAssistantAnimate,
		isAssistantGeneratingText,
		lastAssistantMessage,
		assistantSpeechConfidence,
		transcriptQuality,
		speechTimestamp
	} = useVoiceSessionContext();
	
	const [animationState, setAnimationState] = useState<AnimationState>({
		shouldShowTalkingAnimation: false,
		forceStopAnimation: false,
		animationType: 'idle',
		intensity: 0,
		isUserDominant: false,
		animationName: 'Pearl Animation'
	});

	// Combined detection logic with confidence scoring
	const shouldAnimateMouth = useCallback(() => {
		const lastLen = (lastAssistantMessage ?? '').length;
		const hasContent = lastLen > 0;
		const conf = assistantSpeechConfidence ?? 0;
		const ts = speechTimestamp ?? 0;
		const isHighConfidence = conf > 0.5;
		const hasRecentActivity = Date.now() - ts < 10000; // 10 seconds
		const isQualityTranscript = transcriptQuality === 'final' || transcriptQuality === 'partial';
		
		return isAssistantGeneratingText &&        // Assistant is generating content
				isAssistantSpeaking &&             // Assistant is actively speaking
				!isUserSpeaking &&                 // User is NOT speaking
				canAssistantAnimate &&             // Animations are permitted
				hasContent &&                      // There's actual transcript content
				(isHighConfidence || isQualityTranscript) && // High confidence OR quality transcript
				hasRecentActivity;                 // Recent speech activity
	}, [
		isAssistantGeneratingText, 
		isAssistantSpeaking, 
		isUserSpeaking, 
		canAssistantAnimate, 
		lastAssistantMessage,
		assistantSpeechConfidence,
		transcriptQuality,
		speechTimestamp
	]);

	// Processing state detection
	const isProcessingWithoutTranscript = useCallback(() => {
		const lastLen = (lastAssistantMessage ?? '').length;
		return (isAssistantGeneratingText || isAssistantSpeaking) && 
				!isUserSpeaking && 
				canAssistantAnimate &&
				lastLen === 0;
	}, [isAssistantGeneratingText, isAssistantSpeaking, isUserSpeaking, canAssistantAnimate, lastAssistantMessage]);

	// User speech detection with immediate freeze
	const isUserSpeakingStrict = useCallback(() => {
		return isUserSpeaking === true;
	}, [isUserSpeaking]);

	useEffect(() => {
		const userSpeaking = isUserSpeakingStrict();
		const shouldAnimate = shouldAnimateMouth();
		const isProcessing = isProcessingWithoutTranscript();
		
		let newState: AnimationState;

		if (userSpeaking) {
			// Absolute priority: User is speaking - freeze immediately
			newState = {
				shouldShowTalkingAnimation: false,
				forceStopAnimation: true,
				animationType: 'frozen',
				intensity: 0,
				isUserDominant: true,
				animationName: 'Avatar Transition'
			};
		} else if (shouldAnimate) {
			// Optimized mouth animation when assistant is speaking with content
			const baseIntensity = (assistantVolumeLevel ?? 0) / 100;
			const confidenceBoost = (assistantSpeechConfidence ?? 0) * 0.3;
			const lengthBoost = Math.min(((lastAssistantMessage ?? '').length) / 50, 0.4);
			const qualityBoost = transcriptQuality === 'final' ? 0.2 : 0.1;
			
			const calculatedIntensity = Math.max(
				baseIntensity + confidenceBoost + lengthBoost + qualityBoost,
				0.4 // Minimum intensity for visible animation
			);
			
			newState = {
				shouldShowTalkingAnimation: true,
				forceStopAnimation: false,
				animationType: 'talking',
				intensity: Math.min(calculatedIntensity, 1.0), // Cap at 1.0
				isUserDominant: false,
				animationName: 'Relax Talk Basic 1'
			};
		} else if (isProcessing) {
			// Processing state: subtle animation while generating without transcript
			newState = {
				shouldShowTalkingAnimation: true,
				forceStopAnimation: false,
				animationType: 'talking',
				intensity: 0.25,
				isUserDominant: false,
				animationName: 'Relax Talk Basic 1'
			};
		} else {
			// Idle: no speech activity
			newState = {
				shouldShowTalkingAnimation: false,
				forceStopAnimation: false,
				animationType: 'idle',
				intensity: 0,
				isUserDominant: false,
				animationName: 'Pearl Animation'
			};
		}

		// Multiple safety checks
		if (userSpeaking && newState.shouldShowTalkingAnimation) {
			newState.shouldShowTalkingAnimation = false;
			newState.forceStopAnimation = true;
			newState.animationType = 'frozen';
			newState.animationName = 'Avatar Transition';
		}
		if (!canAssistantAnimate && newState.shouldShowTalkingAnimation) {
			newState.shouldShowTalkingAnimation = false;
			newState.forceStopAnimation = true;
			newState.animationType = 'frozen';
			newState.animationName = 'Avatar Transition';
		}

		setAnimationState(() => newState);
	}, [
		isAssistantSpeaking, 
		isUserSpeaking, 
		assistantVolumeLevel, 
		canAssistantAnimate, 
		isAssistantGeneratingText, 
		lastAssistantMessage, 
		assistantSpeechConfidence,
		transcriptQuality,
		speechTimestamp,
		shouldAnimateMouth,
		isProcessingWithoutTranscript,
		isUserSpeakingStrict
	]);

	return animationState;
};


