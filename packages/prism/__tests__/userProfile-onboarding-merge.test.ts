import { mergeUserProfileOnboardingState } from '../src/core/actions/userProfile-actions';

describe('mergeUserProfileOnboardingState', () => {
  it('merges nested required actions without clobbering previous onboarding state', () => {
    const merged = mergeUserProfileOnboardingState(
      {
        currentBeat: 1,
        completedBeats: ['beat_1'],
        requiredActions: { profileUpdated: true },
        source: 'text',
        promptFeatureKey: 'onboarding',
      },
      {
        currentBeat: 2,
        completedBeats: ['beat_2'],
        requiredActions: { welcomeNoteCreated: true },
      },
    );

    expect(merged).toEqual({
      currentBeat: 2,
      completedBeats: ['beat_2'],
      requiredActions: {
        profileUpdated: true,
        welcomeNoteCreated: true,
      },
      source: 'text',
      promptFeatureKey: 'onboarding',
    });
  });
});
