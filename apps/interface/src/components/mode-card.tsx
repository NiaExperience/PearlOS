'use client';

import { motion, type MotionProps } from 'framer-motion';
import { Dosis } from 'next/font/google';
import type { ReactNode } from 'react';

import styles from './mode-card.module.css';

const dosis = Dosis({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

interface ModeCardProps extends MotionProps {
  image: string;
  label: string;
  textColor: string;
  onClick?: () => void;
  badge?: ReactNode;
  disabled?: boolean;
  onDisabledInteract?: () => void;
}

const ModeCard = ({
  image,
  label,
  textColor,
  onClick,
  badge,
  disabled = false,
  onDisabledInteract,
  ...motionProps
}: ModeCardProps) => {
  const { whileHover, whileTap, ...restMotionProps } = motionProps;

  const handleDisabledInteract = () => {
    if (disabled) {
      onDisabledInteract?.();
    }
  };

  const handleClick = () => {
    if (disabled) {
      handleDisabledInteract();
      return;
    }
    onClick?.();
  };

  return (
    <motion.button
      type="button"
      aria-disabled={disabled}
      onClick={handleClick}
      onMouseEnter={handleDisabledInteract}
      onFocus={handleDisabledInteract}
      onTouchStart={handleDisabledInteract}
      className={`group relative aspect-square w-full overflow-hidden rounded-3xl bg-transparent shadow-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${styles.hoverable} ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
      whileHover={disabled ? undefined : whileHover}
      whileTap={disabled ? undefined : whileTap}
      {...restMotionProps}
    >
      <div className={styles.modeCard}>
        <motion.div
          className={styles.backgroundWrapper}
          style={{ backgroundImage: `url("${image}")` }}
          animate={{ rotate: [0, 0.4, 0] }}
          transition={{ duration: 6, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
        />

        <div className={styles.scrim} />

        <div className={styles.labelWrapper}>
          <span className={`${styles.label} ${dosis.className}`} style={{ color: textColor }}>
            {label}
          </span>
        </div>

        {badge}
      </div>
    </motion.button>
  );
};

export default ModeCard;


