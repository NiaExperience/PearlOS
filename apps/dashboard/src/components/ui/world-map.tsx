'use client';

import { useRef } from 'react';
import { motion } from 'motion/react';
import DottedMap from 'dotted-map';
import Image from 'next/image';
import { useTheme } from 'next-themes';

interface MapProps {
  dots?: Array<{
    start: { lat: number; lng: number; label?: string };
    end: { lat: number; lng: number; label?: string };
  }>;
  lineColor?: string;
}

export function WorldMap({ dots = [], lineColor = '#0ea5e9' }: MapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const map = new DottedMap({ height: 100, grid: 'diagonal' });

  const { theme } = useTheme();

  const svgMap = map.getSVG({
    radius: 0.22,
    color: theme === 'dark' ? '#FFFFFF40' : '#00000040',
    shape: 'circle',
    backgroundColor: theme === 'dark' ? 'black' : 'white',
  });

  return (
    <div className='w-full aspect-[2/1] bg-background rounded-lg  relative font-sans'>
      <Image
        src={`data:image/svg+xml;utf8,${encodeURIComponent(svgMap)}`}
        className='h-full w-full [mask-image:linear-gradient(to_bottom,transparent,white_10%,white_90%,transparent)] pointer-events-none select-none'
        alt='world map'
        height='495'
        width='1056'
        draggable={false}
      />
    </div>
  );
}
