import { PhotoScene, type SceneProps } from './photo-scene'

export default function Still(props: SceneProps) {
  return <PhotoScene {...props} room='intimate' />
}
