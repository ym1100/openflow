# Node Reference (Canonical Canvas Inventory)

This is the single authoritative reference for all nodes, handles, toolbars, and connection rules
available on the Openflow canvas. Always consult this before planning operations.

---

## Registered Node Types

The following node types can be created via `addNode`:

| nodeType | Component | Role |
|---|---|---|
| `mediaInput` | UploadNode | Upload/reference for image, audio, video, or 3D (GLB) |
| `annotation` | LayerEditorNode | Image layer editor — add overlays/annotations to an image |
| `cameraAngleControl` | CameraAngleControlNode | Reframe/recompose image with camera angle settings |
| `comment` | CommentNode | Sticky note — documentation only, NO handles |
| `prompt` | TextNode | LLM/prompt text node — accepts image + text context, outputs text |
| `generateImage` | ImageNode | Image generation |
| `generateVideo` | VideoNode | Video generation |
| `generateAudio` | AudioNode | Audio/TTS/music generation |
| `imageCompare` | ImageCompareNode | Side-by-side A/B image comparison (no outputs) |
| `easeCurve` | EaseCurveNode | Video motion easing/timing configurator |
| `router` | RouterNode | Passthrough by detected content type |
| `switch` | SwitchNode | Named output toggle (user-controlled path selection) |
| `conditionalSwitch` | ConditionalSwitchNode | Rule-based text routing |
| `generate3d` | ThreeDNode | 3D asset generation |
| `glbViewer` | GLBViewerNode | View/render GLB; captures viewport to image |

> `imageInput` and `audioInput` exist in type definitions but are NOT registered as canvas components. Do not emit `addNode` with these types.

---

## Per-Node Handle Reference

### `mediaInput`
| Direction | Handle ID | Data type | Notes |
|---|---|---|---|
| target (input) | `reference` | reference | Incoming reference link |
| target (input) | `audio` | audio | Incoming audio |
| target (input) | `3d` | 3d | Incoming 3D asset |
| source (output) | `image` | image | Output when mode = image or 3D capture |
| source (output) | `audio` | audio | Output when mode = audio |
| source (output) | `video` | video | Output when mode = video |

Key data fields: `mode` ("image"\|"audio"\|"video"\|"3d"), `image`, `filename`, `dimensions`, `audioFile`, `videoFile`, `glbUrl`, `capturedImage`

---

### `annotation` (LayerEditorNode)
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| source | `image` | image |

Key data: `sourceImage`, `annotations`, `outputImage`, transform settings

**Important**: `annotation` is an IMAGE PROCESSING node. It takes an image as input and outputs an annotated/overlaid image. It is NOT a text label or documentation node.

---

### `cameraAngleControl`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| target | `text` | text |
| source | `image` | image |

Key data: `cameraPrompt`, `angleSettings` (`rotation`, `tilt`, `zoom`, `wideAngle`)

---

### `comment`
- **No handles.** Sticky note for canvas documentation and agent guidance.
- Never wire into any edge.

Key data fields:
- `content`: array of `CommentEntry` objects `{ id, text, author, authorType, date }`
- `resolved`: boolean — marks thread as resolved (visual green state, not deleted)
- `resolvedAt`: ISO timestamp of resolution
- `attachedToNodeId` (optional): string id of another canvas node this note refers to (no edge; used for UI + planner context)

`CommentEntry.authorType`:
- `"user"` (default): neutral avatar, human comment
- `"agent"`: indigo star avatar — used when the Flowy AI agent leaves a note

To create an agent guidance note, use `addNode` with `nodeType: "comment"` and set `author: "Flowy"`, `authorType: "agent"` in the content entry.

---

### `prompt`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| target | `text` | text |
| source | `text` | text |

Key data: `prompt`, `outputText`, `provider`, `model`, `temperature`, `maxTokens`, `variableName`

---

### `generateImage`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| target | `text` | text |
| source | `image` | image |

Key data: `inputImages`, `inputPrompt`, `outputImage`, `aspectRatio`, `resolution`, `model`, `selectedModel`, `parameters`

**One text input max. One image input max.**

---

### `generateVideo`
Default handles (when no inputSchema):
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| target | `text` | text |
| source | `video` | video |

Schema-driven handles (when model `inputSchema` defines multiple slots):
- Inputs: `image-0`, `image-1`, … and `text-0`, `text-1`, …
- Output: `video`

Key data: `inputImages`, `inputPrompt`, `outputVideo`, `selectedModel`, `parameters`, `inputSchema`

---

### `generate3d`
Default handles:
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image |
| target | `text` | text |
| source | `3d` | 3d |
| source | `image` | image (viewport capture) |

Schema-driven: same as `generateVideo` (indexed `image-N`, `text-N`).

Key data: `inputImages`, `inputPrompt`, `output3dUrl`, `capturedImage`, `selectedModel`, `parameters`

**Always pair with `glbViewer`** — wire `generate3d.3d → glbViewer.3d`.

---

### `generateAudio`
Default handles:
| Direction | Handle ID | Data type |
|---|---|---|
| target | `text` | text |
| source | `audio` | audio |

Schema-driven: `input.name` for each schema input slot.

Key data: `inputPrompt`, `outputAudio`, `selectedModel`, `parameters`, `duration`, `format`

---

### `imageCompare`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image (first image) |
| target | `image-1` | image (second image) |
| — | NO outputs | — |

Key data: `imageA`, `imageB`

When adding two edges to `imageCompare`: first uses `image`, second uses `image-1`.

---

### `easeCurve`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `video` | video |
| target | `easeCurve` | easeCurve |
| source | `video` | video |
| source | `easeCurve` | easeCurve |

Key data: `bezierHandles` [c1x, c1y, c2x, c2y], `easingPreset`

**Preset names** (set `easingPreset` in data):
`linear`, `easeIn`, `easeOut`, `easeInOut`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `easeInSine`, `easeOutSine`, `easeInOutSine`, `easeInQuart`, `easeOutQuart`, `easeInOutQuart`, `easeInExpo`, `easeOutExpo`, `easeInOutExpo`, `easeInCirc`, `easeOutCirc`, `easeInOutCirc`, `spring`

**Connection rule**: `easeCurve` output only goes to `generateVideo.easeCurve`. Do not wire easeCurve to any other node type (except through `router`).

---

### `router`
Dynamic handles — one per connected/active type:
| Direction | Handle ID | Data type |
|---|---|---|
| target | `image` | image (when connected) |
| target | `text` | text (when connected) |
| target | `video` | video (when connected) |
| target | `audio` | audio (when connected) |
| target | `3d` | 3d (when connected) |
| target | `easeCurve` | easeCurve (when connected) |
| source | (same ids as active inputs) | matches input type |

The router passes each type through to its matching output. Only active (connected) type handles appear.

---

### `switch`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `generic-input` | any (resolved from first connection) |
| source | `<switch-entry-id>` | matches `inputType` |

Key data: `inputType` (set from first connection), `switches[]` (each: `id`, `name`, `enabled`)

When wiring to `switch` as target: always use `targetHandle: "generic-input"`.
Source handles are the individual switch entry IDs defined in `data.switches`.

---

### `conditionalSwitch`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `text` | text |
| source | `<rule.id>` | text (one per rule) |
| source | `default` | text |

Key data: `incomingText`, `rules[]` (each: `id`, `value`, `mode`, `label`, `isMatched`), `evaluationPaused`

Rule modes: `exact`, `contains`, `starts-with`, `ends-with`

---

### `glbViewer`
| Direction | Handle ID | Data type |
|---|---|---|
| target | `3d` | 3d |
| source | `image` | image (captured viewport) |

Key data: `glbUrl`, `filename`, `capturedImage`

---

## Connection Rules Summary

| Source type | Allowed targets |
|---|---|
| `image` | `generateImage`, `generateVideo`, `generate3d`, `annotation`, `cameraAngleControl`, `imageCompare`, `router`, `mediaInput.reference`, `reference` handle of gen nodes |
| `text` | `generateImage`, `generateVideo`, `generate3d`, `generateAudio`, `prompt`, `cameraAngleControl`, `router`, `conditionalSwitch` |
| `video` | `generateVideo`, `easeCurve`, `router` ONLY |
| `audio` | `generateAudio`, `router` ONLY |
| `3d` | `glbViewer`, `router` ONLY |
| `easeCurve` | `generateVideo.easeCurve` ONLY |
| `reference` | target must be `generateImage` or `generateVideo` |

Special cases:
- `switch` target: always `generic-input` (type resolved from first connection)
- `conditionalSwitch` target: always `text`
- `imageCompare` second input: use `image-1` handle
- `router`: allowed on either end of most typed connections

**Unknown / null handle types**: connection allowed (permissive fallback).

---

## Toolbar Actions Per Node

### `generateImage` toolbar (GenerateImageToolbar)
- Provider badge + model selector (nano-banana, nano-banana-2, nano-banana-pro, and catalog models)
- Aspect ratio selector (Gemini models only)
- Resolution selector (Gemini models only)
- **Upscale**: adds a new `generateImage` node + image edge from current output → executes new node
- **Split grid** (2×2, 3×3, 4×4): creates grid of `generateImage` nodes + reference edges
- Crop, 3D Camera Angle, Inpaint, Outpaint: disabled (UI present, not functional)
- Remove background, Split into layers: disabled

### `generateVideo` toolbar (GenerateVideoToolbar)
- Provider + model label
- **Extract first/current/last frame**: adds new `mediaInput` + `reference` edge from video output
- Upscale: disabled
- Remove background: disabled

### `mediaInput` toolbar (UploadToolbar)
- **Image mode**: 3D Camera Angle (`cameraAngleControl` add), Upscale, Split grid; Crop/Inpaint/Outpaint disabled
- **Video mode**: Extract frames; Upscale disabled
- Replace (re-upload), Save, Fullscreen

### `prompt` toolbar (TextNodeToolbar)
- Provider selector: google / openai / anthropic
- Model selector (per provider)
- Temperature slider

### `generate3d` toolbar (Generate3DToolbar)
- Provider badge + model label only

### `annotation` toolbar (LayerEditorNodeToolbar)
- Edit layers (open layer editor)
- Fullscreen

---

## Group Colors

`neutral` (grey), `blue`, `green`, `purple`, `orange`, `red`

Group semantics (recommended):
- `blue` = input / reference stage
- `green` = generation stage
- `purple` = output / review stage
- `orange` = special / annotation layer
- `neutral` = misc / ungrouped

---

## Execution Behavior

- `executeNodeIds` triggers `executeSelectedNodes(nodeIds)` in the canvas store.
- Execution runs level-by-level in topological order; nodes within a level run in parallel.
- Downstream `glbViewer` and `imageCompare` nodes are auto-refreshed after selection run completes.
- Nodes that are NO-OPS (never execute): `mediaInput`, `comment`, `imageCompare` (display only), `easeCurve` (config only), `glbViewer` (viewer only), `router`, `switch`, `conditionalSwitch`, `annotation` (renders inline).
- Always target terminal generation nodes: `generateImage`, `generateVideo`, `generateAudio`, `generate3d`, `prompt` (if text output needed).

---

## Model Defaults (from planner_schema.json)

| Context | Model alias |
|---|---|
| Default image | `nano-banana` |
| High quality image | `nano-banana-pro` |
| Image with text | `seedream` |
| Photorealistic | `nano-banana` |
| Video | `veo` |
| Text/LLM | `gemini` |

Full model catalog is available at runtime via `/api/models` (providers: Gemini, fal, Replicate, WaveSpeed, Kie).
