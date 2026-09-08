import { PhotoScene, type SceneProps } from './photo-scene'

export default function AfterHours(props: SceneProps) {
  return <PhotoScene {...props} room='after-hours' living />
}
