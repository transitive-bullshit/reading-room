import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Quaternion, Vector3 } from 'three'

import {
  alignCamera,
  makeCamera,
  offscreenDropPosition
} from '../app/prototypes/reading-room/variants/physics-camera'
import { getPileDrop } from '../app/prototypes/reading-room/variants/physics-pile'
import { bookDimensions } from '../app/prototypes/reading-room/variants/physics-world'

void test('every rotated book starts entirely above the render frame at desktop table sizes', () => {
  for (const fit of [1, 0.76]) {
    const camera = makeCamera()
    alignCamera(camera, fit)
    for (let index = 0; index < 25; index++) {
      const dimensions = bookDimensions(
        0.56 + (index % 6) * 0.025,
        200 + index * 35
      )
      const drop = getPileDrop(index, 25, false, dimensions)
      const quaternion = new Quaternion(
        drop.rotation.x,
        drop.rotation.y,
        drop.rotation.z,
        drop.rotation.w
      )
      const initial = new Vector3(
        drop.position.x,
        drop.position.y,
        drop.position.z
      )
      const position = offscreenDropPosition(
        camera,
        dimensions,
        quaternion,
        initial
      )
      assert.equal(position.x, initial.x)
      assert.equal(position.z, initial.z)
      for (const x of [-1, 1])
        for (const y of [-1, 1])
          for (const z of [-1, 1]) {
            const corner = new Vector3(
              (x * dimensions.width) / 2,
              (y * dimensions.height) / 2,
              (z * dimensions.depth) / 2
            )
              .applyQuaternion(quaternion)
              .add(position)
              .project(camera)
            assert.ok(
              corner.y > 1.04,
              `Book ${index} popped into the frame at fit ${fit}`
            )
            assert.ok(
              corner.z > -1 && corner.z < 1,
              'Book crosses the camera clipping plane'
            )
          }
    }
  }
})
