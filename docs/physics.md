# Reading-table physics

Use this reference when changing collisions, dragging, pickup, grouping, or scene registration. [design.md](design.md) owns the collection and grouping semantics; [audio.md](audio.md) owns contact sound; [assets.md](assets.md) owns source imagery and textures.

## Simulation and rendering

[physics-world.ts](../app/prototypes/reading-room/variants/physics-world.ts) runs Rapier at 120 fixed steps per second. Rounded cuboid colliders, mass, friction, gravity, damping, and continuous collision detection govern the books. Reset accumulated forces and torques before each step. Live physics and natural-mound preparation share the same table boundary forces.

Books are rigid closed volumes. Page count determines thickness and mass. A transparent Three.js scene places their meshes, contact shadows, and selection lighting over the After Hours photograph. Keep each book's body, collider, mesh, and identity together across grouping changes.

For the larger collection, compact geometry reduces draw calls, GPU cover textures have a maximum edge of 768 pixels, and pixel ratio is capped at 1.5. Both outward cover planes share their texture and material. Original detail covers and material masters remain separate from these rendering optimizations.

## Dragging, pickup, and return

Dragging uses a capped, damped spring with pointer-velocity feedback. Measure the grab offset on screen so lifting a book preserves its registration to the pointer. While held, a bounded quaternion-error torque favors a camera-facing cover and a roll chosen once within ±15°. The body remains dynamic: contact can deflect it, and the controller recovers afterward. Releasing removes the orientation bias and bounds the throw velocity; resting books retain their physical orientation.

A short click scatters covering books, extracts the selection laterally, and guides its lift and camera alignment through position-based kinematic targets. The cover finishes upright and parallel to the camera. The collider participates until the book clears the stack, then stops participating for the reading-view handoff. Focus the keyboard book button before opening the HTML dialog. Closing guides the book above its return location, re-enables its collider, and restores dynamic settling onto the current surroundings.

## Initial drop and natural-mound memory

[physics-pile.ts](../app/prototypes/reading-room/variants/physics-pile.ts) supplies initial conditions. Project each rotated book's complete bounds above the frame before activation, then release it with downward momentum and a stagger. The larger pile uses a broader footprint. Gravity and contacts establish the natural heap.

[physics-mound.ts](../app/prototypes/reading-room/variants/physics-mound.ts) preserves that untouched heap's full positions and quaternions before the first grab, pickup, or grouping change. Capture requires the complete book set with enabled, dynamic, sufficiently settled bodies and colliders. The first saved result remains authoritative after books move or become organized.

If interaction starts before the heap settles, an isolated Rapier world prepares it from the same dimensions, offscreen poses, activation delays, and boundary forces. This fallback simulates 12 seconds, yields in roughly 4 ms slices, shares one cached promise, and leaves the visible bodies untouched. Replacing a book batch or destroying the scene cancels preparation and frees its world. Membership and mobile-breakpoint changes create fresh memory.

Free pile requires a complete remembered map. Preserving full rotations retains the leaning books, varied headings, and irregular contact arrangement that make the original mound feel natural. Visible books travel from their current poses over 1.8 seconds with a shallow 0.16-unit arc and bounded velocity carry. Their destinations share a 0.12-unit vertical offset above the saved heap, keeping the relative book spacing intact. They arrive together, hold for 0.12 seconds, then return to dynamic physics with zero linear and angular velocity. Gravity closes that small gap in a visible final settle. The saved poses stay unchanged, so repeated returns do not accumulate height. Page load and Replay retain the initial drop.

## Organized arrangements and interruption

[physics-rearrange.ts](../app/prototypes/reading-room/variants/physics-rearrange.ts) lays out up to three columns and two rows. Larger groups use two stacks spaced for rotated cover widths; wide square covers bridge above them. Labels project into the same scaled frame as the books.

Organized moves capture live position, velocity, and rotation, then use a staggered kinematic lift, glide, and lowering sequence with colliders enabled. Gravity finishes the landing. Guides advance with simulation time, so hidden-tab pauses cannot expire unfinished moves.

New choices supersede pending arrangements and retarget from current poses. Grabbing or picking up a moving book cancels its guide immediately. A grouping chosen during pickup preserves the new return destination. Apply the latest grouping after pending texture loads, discard stale batches, and keep the current grouping through Replay. Audio, rain, and fire controls preserve book identity and arrangement.

## Category browsing

Choosing an organized pile keeps the complete collection in the runtime. The selected group spreads into rows with exposed covers. Other books fly beyond the frame and park there with their colliders disabled. Parked books remain allocated, preserving their identity for the return trip, but cannot be hovered, picked up, or reached through the keyboard book controls.

[physics-focus.ts](../app/prototypes/reading-room/variants/physics-focus.ts) fits the selected group using actual cover dimensions. A shared scale keeps every cover visible when the group is large; apply the same scale to each mesh and its existing collider. Returning to the overview restores the original dimensions and guides all books back to the current grouping. Retarget interrupted flights from their current poses. The free-mound memory always uses the original dimensions and saved poses.

The parent retains the full book batch and passes the selected group separately. Filtering the batch itself would rebuild the scene and lose the outgoing books. Native label buttons must stop table hit testing beneath them. On entry, focus moves to the breadcrumb; on return, it moves to the current grouping control.

## Scene registration and verification

[physics-camera.ts](../app/prototypes/reading-room/variants/physics-camera.ts) calibrates the tabletop's four corners to the photograph with a projective correction. Books, labels, shadows, and the rain mask must share the photograph's cover fit and scene-frame transform. Rain geometry remains clipped to the glass through viewport changes.

[The rearrangement tests](../tests/reading-room-rearrange.test.ts) use actual 86-book Rapier worlds. They verify complete saved poses, restored position and rotation error, and tilt and heading diversity relative to the initial heap. They also cover shallow paths, zero-speed release, retention, repeated grouping, interrupted movement, offscreen Replay, and isolated asynchronous preparation. Complement these with the drag, held-book, entry, and rain tests and an actual browser check of the photographed scene.

[The category tests](../tests/reading-room-focus.test.ts) check every group with the live book order, complete book bounds, and nonoverlapping covers through the room camera. They verify body and collider identity, mass, and pose through size changes, then run the largest category through actual guided movement and settling with the live boundary forces.
