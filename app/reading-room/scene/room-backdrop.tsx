'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  afterHoursRainSize,
  afterHoursWindowPanes
} from './rain-window-geometry'

import './room-backdrop.css'

type Point = [number, number]

function RainWindow({ enabled }: { enabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointer = useRef<Point | null>(null)
  const width = afterHoursRainSize.width
  const height = afterHoursRainSize.height
  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx || !enabled) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const drops = Array.from({ length: 130 }, (_, i) => ({
      x: (i * 139.39) % width,
      y: (i * 73.41) % height,
      speed: 0.5 + (i % 7) * 0.24,
      length: 5 + (i % 13) * 2,
      alpha: 0.1 + (i % 5) * 0.035
    }))
    let frame = 0,
      previous = 0
    const paint = (time: number) => {
      const delta = Math.min((time - previous) / 16.67 || 1, 3)
      previous = time
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      {
        ctx.beginPath()
        for (const pane of afterHoursWindowPanes) {
          pane.forEach(([x, y], index) => {
            if (index === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.closePath()
        }
        ctx.clip()
      }
      for (const drop of drops) {
        if (!reduced.matches)
          drop.y = (drop.y + drop.speed * delta) % (height + 10)
        const close =
          pointer.current &&
          Math.hypot(drop.x - pointer.current[0], drop.y - pointer.current[1]) <
            64
        ctx.strokeStyle = `rgba(190,215,226,${close ? drop.alpha * 2.2 : drop.alpha})`
        ctx.lineWidth = close ? 1.5 : 0.7
        ctx.beginPath()
        ctx.moveTo(drop.x, drop.y)
        ctx.lineTo(drop.x - 1.3, drop.y + drop.length)
        ctx.stroke()
        ctx.fillStyle = `rgba(207,229,235,${drop.alpha})`
        ctx.beginPath()
        ctx.ellipse(drop.x, drop.y + drop.length, 0.9, 1.8, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      if (!reduced.matches && !document.hidden)
        frame = requestAnimationFrame(paint)
    }
    const resume = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    reduced.addEventListener('change', resume)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', resume)
      reduced.removeEventListener('change', resume)
      ctx.clearRect(0, 0, width, height)
    }
  }, [enabled, width, height])
  return (
    <canvas
      width={width}
      height={height}
      ref={canvas}
      className='rain-window'
      aria-label='Rain on the window'
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        pointer.current = [
          ((event.clientX - rect.left) / rect.width) * width,
          ((event.clientY - rect.top) / rect.height) * height
        ]
      }}
      onPointerLeave={() => {
        pointer.current = null
      }}
      style={{ opacity: enabled ? 1 : 0 }}
    />
  )
}

export function RoomBackdrop({
  living = true,
  rain = true,
  fire = true
}: {
  living?: boolean
  rain?: boolean
  fire?: boolean
}) {
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [stoked, setStoked] = useState(false)
  const stokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    const parent = stage.current
    if (!parent) return
    const update = () => {
      const scale = Math.max(
        parent.clientWidth / 1600,
        parent.clientHeight / 900
      )
      frame.current?.style.setProperty('--scene-scale', String(scale))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      if (stokeTimer.current) clearTimeout(stokeTimer.current)
    },
    []
  )

  return (
    <div className='room-backdrop' ref={stage}>
      <div className='scene-frame' ref={frame}>
        <img
          className='room-plate'
          src='/rooms/after-hours.jpg'
          alt='A walnut table in an atmospheric mansion library, with a rainy window, emerald chairs and a glowing fireplace.'
          draggable={false}
          fetchPriority='high'
        />
        {living && (
          <>
            <RainWindow enabled={rain} />
            <div
              className={`room-firewash ${fire ? 'is-lit' : ''} ${stoked ? 'is-stoked' : ''}`}
              aria-hidden='true'
            />
            <button
              className='hearth-hotspot'
              aria-label='Stoke the fireplace'
              title='Stoke the fire'
              onClick={() => {
                setStoked(true)
                if (stokeTimer.current) clearTimeout(stokeTimer.current)
                stokeTimer.current = setTimeout(() => setStoked(false), 1800)
              }}
            >
              <span>Stoke the fire</span>
            </button>
            <div
              className={`room-flame ${fire ? 'is-lit' : ''}`}
              aria-hidden='true'
            />
          </>
        )}
      </div>
    </div>
  )
}
