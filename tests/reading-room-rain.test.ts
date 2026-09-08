import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  afterHoursRainSize,
  afterHoursWindowPanes
} from '../app/prototypes/reading-room/variants/rain-window-geometry'

function onGlass(x: number, y: number) {
  return afterHoursWindowPanes.some((points) => {
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]!
      const [xj, yj] = points[j]!
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside
    }
    return inside
  })
}

void test('rain excludes the photographed lamp, mullions, frame, and sill', () => {
  for (const [name, x, y] of [
    ['lamp shade', 170, 50],
    ['lamp stem', 43, 190],
    ['left vertical mullion', 250, 200],
    ['right vertical mullion', 370, 120],
    ['horizontal mullion', 310, 158],
    ['right frame', 500, 100],
    ['sill', 300, 275]
  ] as const)
    assert.equal(onGlass(x, y), false, name)
})

void test('rain still covers the glass on both sides of the window', () => {
  for (const [x, y] of [
    [90, 210],
    [170, 210],
    [300, 120],
    [430, 210]
  ] as const)
    assert.equal(onGlass(x, y), true)
  for (const pane of afterHoursWindowPanes) {
    for (const [x, y] of pane) {
      assert.ok(x >= 0 && x < afterHoursRainSize.width)
      assert.ok(y > -1 && y < afterHoursRainSize.height)
    }
  }
})
