import { useId } from 'react';

interface GradientBackgroundProps {
  className?: string;
}

export function GradientBackground({ className = '' }: GradientBackgroundProps) {
  const grainId = useId().replace(/:/g, '');

  return (
    <div aria-hidden="true" className={className} style={{ position: 'relative', overflow: 'hidden' }}>
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#E14923',
          backgroundImage:
            'radial-gradient(circle at 66.94% 46.43%, rgba(225,73,35,1) 0%, rgba(225,73,35,.84) 19%, rgba(225,73,35,.5) 38%, rgba(225,73,35,0) 76%), radial-gradient(circle at 34.69% 66.31%, rgba(255,154,82,1) 0%, rgba(255,154,82,.84) 13%, rgba(255,154,82,.5) 25%, rgba(255,154,82,0) 51%), radial-gradient(circle at 48.93% 19.32%, rgba(255,145,0,1) 0%, rgba(255,145,0,.84) 17%, rgba(255,145,0,.5) 34%, rgba(255,145,0,0) 67%)',
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.22] mix-blend-overlay">
        <filter id={grainId}>
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>
    </div>
  );
}
