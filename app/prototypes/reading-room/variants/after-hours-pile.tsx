'use client'

import AfterHours3D from './after-hours-3d'
import type { SceneProps } from './photo-scene'

export default function BookPile(props: SceneProps) {
  return <AfterHours3D {...props} mode='pile' />
}
