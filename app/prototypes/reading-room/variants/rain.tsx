import { PhotoScene, type SceneProps } from './photo-scene'

export default function Rain(props: SceneProps) {
  return <PhotoScene {...props} room='grand' living />
}
