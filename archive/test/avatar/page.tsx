'use client';
import React, { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
// Import only types directly (they are erased at runtime)
import type { Avatar3DHandle, AvatarMood, VowelShape } from '@interface/components/anim/Avatar3D';

// Local copy of Avatar3DProps (kept in sync with the component definition)
type Avatar3DProps = {
  mood?: AvatarMood;
  isSpeaking?: boolean;
  volumeLevel?: number;
};

// Dynamically import the component without SSR
// @ts-expect-error -- path alias resolved by Next.js/webpack runtime
const Avatar3DLazy = dynamic(() => import('@interface/components/anim/Avatar3D'), {
  ssr: false,
});

// Create a thin wrapper so we can forward refs through the dynamic component
const Avatar3D = React.forwardRef<Avatar3DHandle, Avatar3DProps>((props, ref) => (
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error ref forwarding through dynamic component
  <Avatar3DLazy {...props} ref={ref} />
));

Avatar3D.displayName = 'Avatar3D.DynamicWrapper';

const AvatarTestPage = () => {
  const avatarRef = useRef<Avatar3DHandle>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(50);
  const [mood, setMood] = useState<AvatarMood>('neutral');
  // Keep a mouthShape ref for manual control without storing in state (not needed for re-render)
  // We still allow manual mouth shape via the Avatar3D ref.
  const [mouthShape, setMouthShape] = useState<VowelShape | null>(null);

  const handleMoodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMood = e.target.value as AvatarMood;
    setMood(newMood);
    avatarRef.current?.setMood(newMood);
  };

  const handleMouthShapeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newShape = e.target.value as VowelShape;
    setMouthShape(newShape);
    avatarRef.current?.setMouthShape(newShape);
  };

  const handleWink = () => {
    avatarRef.current?.triggerExpression('wink');
  };

  const handleBlink = () => {
    avatarRef.current?.triggerExpression('blink');
  };

  const toggleSpeaking = () => {
    setIsSpeaking(!isSpeaking);
  };

  const buttonStyle: React.CSSProperties = {
    background: '#9b59b6',
    color: 'white',
    border: 'none',
    padding: '10px 20px',
    margin: '5px',
    borderRadius: '5px',
    cursor: 'pointer',
  };

  const selectStyle: React.CSSProperties = {
    ...buttonStyle,
    appearance: 'none',
    paddingRight: '30px',
    background: '#9b59b6 url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%23fff\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3e%3c/svg%3e") no-repeat right 10px center',
    backgroundSize: '12px',
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#2c3e50',
    fontFamily: 'sans-serif',
  };

  const controlsContainerStyle: React.CSSProperties = {
    marginTop: '20px',
    padding: '20px',
    background: '#34495e',
    borderRadius: '10px',
    boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: '10px'
  };

  return (
    <div style={containerStyle}>
      <h1 style={{ color: '#ecf0f1' }}>Avatar 3D Test Environment</h1>
      <Avatar3D ref={avatarRef} isSpeaking={isSpeaking} volumeLevel={volume} mood={mood} />
      <div style={controlsContainerStyle}>
        <button onClick={toggleSpeaking} style={buttonStyle}>
          {isSpeaking ? 'Stop Speaking' : 'Start Speaking'}
        </button>
        <button onClick={handleWink} style={buttonStyle}>Wink</button>
        <button onClick={handleBlink} style={buttonStyle}>Blink</button>
        
        <select value={mood} onChange={handleMoodChange} style={selectStyle}>
          <option value="neutral">Neutral</option>
          <option value="happy">Happy</option>
          <option value="surprised">Surprised</option>
          <option value="angry">Angry</option>
          <option value="curious">Curious</option>
        </select>
        
        <select onChange={handleMouthShapeChange} defaultValue="" style={selectStyle}>
          <option value="" disabled>Manual Mouth Shape</option>
          <option value="a">A</option>
          <option value="e">E</option>
          <option value="i">I</option>
          <option value="o">O</option>
          <option value="u">U</option>
          <option value="closed">Closed</option>
        </select>
        
        <div style={{ width: '100%', textAlign: 'center', marginTop: '10px' }}>
          <label htmlFor="volume" style={{ color: '#ecf0f1', marginRight: '10px' }}>Volume</label>
          <input 
            type="range" 
            id="volume" 
            min="0" 
            max="100" 
            value={volume} 
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ accentColor: '#9b59b6' }}
          />
        </div>
      </div>
    </div>
  );
};

export default AvatarTestPage; 