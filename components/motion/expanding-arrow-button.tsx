'use client'
// beui.dev/components/motion/expanding-arrow-button

import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'
import {
  forwardRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode
} from 'react'
import { EASE_OUT, SPRING_LAYOUT, SPRING_PRESS } from '@/lib/ease'
import { useHoverCapable } from '@/lib/hooks/use-hover-capable'
import { cn } from '@/lib/utils'
import './expanding-arrow-button.css'

export interface ExpandingArrowButtonProps extends Omit<
  HTMLMotionProps<'button'>,
  'children'
> {
  children: ReactNode
  size?: 'entry' | 'compact'
  accentClassName?: string
  labelClassName?: string
}

const ARROW_OPACITY = [1, 0.78, 0.54, 0.32, 0.16] as const

function DottedChevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 20 28'
      fill='none'
      aria-hidden='true'
      className={className}
    >
      <circle cx='4' cy='4' r='2' fill='currentColor' />
      <circle cx='10' cy='9' r='2' fill='currentColor' />
      <circle cx='16' cy='14' r='2' fill='currentColor' />
      <circle cx='10' cy='19' r='2' fill='currentColor' />
      <circle cx='4' cy='24' r='2' fill='currentColor' />
    </svg>
  )
}

export const ExpandingArrowButton = forwardRef<
  HTMLButtonElement,
  ExpandingArrowButtonProps
>(function ExpandingArrowButton(
  {
    children,
    size = 'entry',
    className,
    accentClassName,
    labelClassName,
    disabled,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    ...rest
  },
  ref
) {
  const reduce = useReducedMotion()
  const canHover = useHoverCapable()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const active = !disabled && ((canHover && hovered) || focused)
  const layoutTransition = reduce ? { duration: 0 } : SPRING_LAYOUT

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(true)
    onMouseEnter?.(event)
  }

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(false)
    onMouseLeave?.(event)
  }

  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(true)
    onFocus?.(event)
  }

  const handleBlur = (event: FocusEvent<HTMLButtonElement>) => {
    setFocused(false)
    onBlur?.(event)
  }

  return (
    <motion.button
      ref={ref}
      type='button'
      disabled={disabled}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      whileTap={reduce || disabled ? undefined : { scale: 0.97 }}
      transition={SPRING_PRESS}
      className={cn(
        'expanding-arrow-button',
        size === 'compact' && 'expanding-arrow-button--compact',
        className
      )}
      {...rest}
    >
      <motion.span
        layout='size'
        aria-hidden='true'
        transition={layoutTransition}
        style={{
          width: active ? 'calc(100% - 12px)' : size === 'compact' ? 36 : 52
        }}
        className={cn('expanding-arrow-accent', accentClassName)}
      >
        <motion.span
          animate={{ opacity: active ? 0 : 1 }}
          transition={{ duration: reduce ? 0 : 0.1, ease: EASE_OUT }}
          className='absolute inset-0 grid place-items-center'
        >
          <DottedChevron className='expanding-arrow-chevron' />
        </motion.span>

        <span className='absolute inset-0 flex items-center justify-around px-3'>
          {ARROW_OPACITY.map((opacity, index) => (
            <motion.span
              key={opacity}
              animate={{
                opacity: active ? opacity : 0,
                transform:
                  active && !reduce ? 'translateX(0px)' : 'translateX(-6px)'
              }}
              transition={{
                duration: reduce ? 0 : 0.18,
                delay: active && !reduce ? 0.04 + index * 0.025 : 0,
                ease: EASE_OUT
              }}
              className='inline-grid place-items-center'
            >
              <DottedChevron className='expanding-arrow-chevron' />
            </motion.span>
          ))}
        </span>
      </motion.span>

      <motion.span
        animate={{
          opacity: active ? 0 : 1,
          transform: active && !reduce ? 'translateX(6px)' : 'translateX(0px)'
        }}
        transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }}
        className={cn('expanding-arrow-label', labelClassName)}
      >
        {children}
      </motion.span>
    </motion.button>
  )
})
