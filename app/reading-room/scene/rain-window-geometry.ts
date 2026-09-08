type RainPoint = readonly [number, number]

// Inner glass edges in the 1672 × 941 source photograph. Separate panes omit
// mullions, the sill, and the foreground lamp instead of masking one large box.
const photographedPanes: readonly (readonly RainPoint[])[] = [
  [
    [198, 0],
    [231, 0],
    [236, 84],
    [232, 91]
  ],
  [
    [143, 126],
    [233, 114],
    [244, 113],
    [246, 157],
    [145, 162]
  ],
  [
    [146, 179],
    [248, 174],
    [255, 250],
    [151, 263]
  ],
  [
    [71, 131],
    [109, 127],
    [119, 165],
    [73, 169]
  ],
  [
    [74, 184],
    [120, 181],
    [128, 258],
    [80, 264]
  ],
  [
    [267, 0],
    [372, 0],
    [375, 71],
    [271, 78]
  ],
  [
    [273, 91],
    [376, 86],
    [380, 157],
    [277, 162]
  ],
  [
    [279, 177],
    [380, 171],
    [386, 241],
    [282, 253]
  ],
  [
    [401, 0],
    [476, 0],
    [481, 67],
    [405, 72]
  ],
  [
    [406, 87],
    [481, 82],
    [484, 149],
    [410, 156]
  ],
  [
    [412, 171],
    [486, 164],
    [490, 236],
    [417, 244]
  ]
]

const photoScale = Math.max(1600 / 1672, 900 / 941)
const offsetY = (900 - 941 * photoScale) / 2

// Match the photograph's centered object-fit: cover inside the shared scene
// frame. The parent frame supplies viewport scaling and cropping to both layers.
export const afterHoursWindowPanes: readonly (readonly RainPoint[])[] =
  photographedPanes.map((pane) =>
    pane.map(([x, y]) => [x * photoScale, y * photoScale + offsetY] as const)
  )

export const afterHoursRainSize = { width: 480, height: 270 } as const
