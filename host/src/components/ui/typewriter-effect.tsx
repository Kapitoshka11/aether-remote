import { motion } from 'motion/react';

export interface TypewriterWord {
  text: string;
  className?: string;
}

interface TypewriterEffectProps {
  words: TypewriterWord[];
  className?: string;
  cursorClassName?: string;
}

export function TypewriterEffectSmooth({
  words,
  className = '',
  cursorClassName = '',
}: TypewriterEffectProps) {
  return (
    <div className={`inline-flex max-w-full items-center ${className}`} aria-label={words.map(({ text }) => text).join(' ')}>
      <motion.span
        aria-hidden="true"
        className="inline-flex max-w-full overflow-hidden whitespace-nowrap"
        initial={{ width: 0 }}
        animate={{ width: 'auto' }}
        transition={{ duration: 1.8, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {words.map((word, index) => (
          <span key={`${word.text}-${index}`} className={word.className}>
            {word.text}{index < words.length - 1 ? '\u00a0' : ''}
          </span>
        ))}
      </motion.span>
      <motion.span
        aria-hidden="true"
        className={`ml-1 inline-block h-[1em] w-[2px] rounded-full bg-current ${cursorClassName}`}
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
