import React from 'react';

interface AppLogoIconProps {
  className?: string;
  showShadow?: boolean;
}

export const AppLogoIcon: React.FC<AppLogoIconProps> = ({
  className = "w-11 h-11",
  showShadow = false
}) => {
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden rounded-[22%] bg-[#121215] border border-white/10 ${
        showShadow ? 'shadow-md shadow-black/50' : ''
      } ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-transparent pointer-events-none rounded-[22%]" />

      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-[58%] h-[58%] relative z-10"
      >
        <rect
          x="32"
          y="40"
          width="136"
          height="88"
          rx="18"
          fill="none"
          stroke="white"
          strokeWidth="11"
          strokeLinejoin="round"
        />
        <line
          x1="100"
          y1="128"
          x2="100"
          y2="150"
          stroke="white"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <line
          x1="74"
          y1="150"
          x2="126"
          y2="150"
          stroke="white"
          strokeWidth="11"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};



