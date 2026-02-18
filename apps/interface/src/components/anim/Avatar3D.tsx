import React from 'react';

export type AvatarMood = 'neutral' | 'happy' | 'surprised' | 'angry' | 'curious';
export type VowelShape = 'a' | 'e' | 'i' | 'o' | 'u' | 'closed';

export interface Avatar3DHandle {
  setMood: (mood: AvatarMood) => void;
  setMouthShape: (shape: VowelShape) => void;
  triggerExpression: (expression: string) => void;
}

interface Avatar3DProps {
  mood?: AvatarMood;
  isSpeaking?: boolean;
  volumeLevel?: number;
}

const Avatar3D = React.forwardRef<Avatar3DHandle, Avatar3DProps>((props, ref) => {
  // Placeholder implementation for test purposes
  React.useImperativeHandle(ref, () => ({
    setMood: () => {},
    setMouthShape: () => {},
    triggerExpression: () => {},
  }));

  return (
    <div style={{ 
      width: '200px', 
      height: '200px', 
      backgroundColor: '#ddd', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      borderRadius: '50%',
      margin: '20px'
    }}>
      <span>Avatar3D Placeholder</span>
    </div>
  );
});

Avatar3D.displayName = 'Avatar3D';

export default Avatar3D; 