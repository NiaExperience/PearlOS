import { CloudMoon, BellOff } from 'lucide-react';
import React, { useEffect } from 'react';

import { useToast } from '@interface/hooks/use-toast';

const Star = ({ size = 2, top, left, delay = 0 }: { size?: number; top: string; left: string; delay?: number }) => (
  <div 
    className={`absolute w-${size} h-${size} rounded-full bg-white opacity-80 animate-twinkle-delay-${delay}`}
    style={{ top, left }}
  />
);

const ShootingStar = ({ top, left, delay }: { top: string; left: string; delay: number }) => (
  <div 
    className="absolute w-0.5 h-0.5 bg-white animate-shooting-star"
    style={{ 
      top, 
      left, 
      animationDelay: `${delay}s`, 
      animationDuration: `${4 + Math.random() * 3}s` 
    }}
  />
);

const SleepScreen = () => {
  const { toast } = useToast();
  
  // Set viewport height as a CSS variable to ensure proper height on mobile
  useEffect(() => {
    const setViewportHeight = () => {
      document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };
    
    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    
    return () => window.removeEventListener('resize', setViewportHeight);
  }, []);
  
  const handleWakeUp = () => {
    toast({
      title: "Shhh! Let her sleep",
      description: "Nia needs her rest. Please try again later.",
      variant: "destructive"
    });
  };

  return (
    <div 
      className="relative w-full overflow-hidden bg-gradient-to-b from-nia-dark via-nia-blue to-[#173a56]"
      style={{ 
        height: 'calc(var(--vh, 1vh) * 100)',
        minHeight: '-webkit-fill-available'
      }}
    >
      {/* Stars background */}
      <div className="absolute inset-0">
        {Array.from({ length: 50 }).map((_, i) => (
          <Star 
            key={i} 
            size={Math.floor(Math.random() * 3) + 1}
            top={`${Math.random() * 100}%`} 
            left={`${Math.random() * 100}%`}
            delay={Math.floor(Math.random() * 3)}
          />
        ))}

        {/* Shooting stars */}
        {Array.from({ length: 5 }).map((_, i) => (
          <ShootingStar
            key={i}
            top={`${Math.random() * 40}%`}
            left={`${Math.random() * 70}%`}
            delay={i * 2 + Math.random() * 5}
          />
        ))}
      </div>
      
      {/* Animated night sky with pulsing effect */}
      <div className="absolute inset-0 bg-[url('/lovable-uploads/9cff5f2d-9541-4ff7-8a45-ad772d36c1e7.png')] bg-cover bg-center opacity-10 animate-pulse-slow" />
      
      {/* Logo */}
      <div className="absolute top-5 left-5 text-nia-accent font-bold">
        <div className="text-2xl">Seatrade</div>
        <div className="text-2xl">Cruise</div>
        <div className="text-xl">Global</div>
        <div className="text-sm mt-1 text-white/70">CONCIERGE AI</div>
      </div>
      
      {/* Content area */}
      <div className="relative flex flex-col items-center justify-center h-full z-10">
        <div className="animate-float mb-8">
          <CloudMoon size={100} className="text-white opacity-90 animate-breathe" />
        </div>
        
        <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tight">
          on&nbsp;&nbsp;<span className="text-nia-accent">Shore</span>&nbsp;&nbsp;Leave
        </h1>
        <p className="text-white/80 text-lg md:text-xl max-w-md text-center mb-10">
        Nia’s taking a short break but will be back soon to assist you.
        </p>
      </div>
      
      
      {/* Footer */}
      <footer className='w-full py-[4px] bottom-0 absolute'>
          <div className='flex items-end justify-center'>
            <p className='text-center uppercase text-[color:--scg-sunset]' style={{ fontWeight: 'bold', fontSize: '10px' }}>
              Powered by
            </p>
            <img className='w-[80px] ml-1' src='/images/NiaLogo.png' alt='Nia Concierge AI' />
          </div>
        </footer>
      {/* <div className="absolute bottom-8 left-0 right-0 text-center">
        <div className="flex flex-col md:flex-row items-center justify-center gap-2">
          <span className="text-white/60">POWERED BY</span>
          <span className="text-2xl font-light italic text-white">Nia</span>
          <span className="text-xs text-white/60">Concierge AI</span>
        </div>
      </div> */}
      {/* <div className="absolute bottom-8 right-8 flex items-center gap-2">
        <span className="text-white/60">POWERED BY</span>
        <span className="text-2xl font-light italic text-white">Nia</span>
        <span className="text-xs text-white/60 mt-auto mb-1">Concierge AI</span>
      </div> */}
      
      {/* Rotating stars background */}
      <div className="absolute inset-0 opacity-30 animate-rotate-slow pointer-events-none">
        <div className="absolute h-full w-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-transparent to-nia-accent/20 rounded-full transform scale-150"></div>
      </div>
    </div>
  );
};

export default SleepScreen; 