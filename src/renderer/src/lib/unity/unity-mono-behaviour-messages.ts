import { messagesOf } from './unity-event-function-types'

export const MONO_BEHAVIOUR_MESSAGES = messagesOf('MonoBehaviour', [
  ['Awake', '', 'Called when the script instance is being loaded, before any Start.'],
  ['OnEnable', '', 'Called when the object becomes enabled and active.'],
  [
    'Start',
    '',
    'Called before the first frame update, only if the script instance is enabled.',
    { coroutine: true }
  ],
  ['FixedUpdate', '', 'Frame-rate independent update for physics calculations.', { perf: true }],
  ['Update', '', 'Called every frame while the MonoBehaviour is enabled.', { perf: true }],
  [
    'LateUpdate',
    '',
    'Called every frame after all Update functions have been called.',
    { perf: true }
  ],
  ['OnDisable', '', 'Called when the behaviour becomes disabled.'],
  ['OnDestroy', '', 'Called when the MonoBehaviour will be destroyed.'],
  [
    'OnValidate',
    '',
    'Editor-only: called when the script is loaded or a value changes in the Inspector.'
  ],
  ['Reset', '', 'Editor-only: called when the component is first added or Reset is chosen.'],
  [
    'OnApplicationFocus',
    'bool hasFocus',
    'Sent to all GameObjects when the player gets or loses focus.',
    { coroutine: true }
  ],
  [
    'OnApplicationPause',
    'bool pauseStatus',
    'Sent to all GameObjects when the application pauses.',
    { coroutine: true }
  ],
  ['OnApplicationQuit', '', 'Sent to all GameObjects before the application quits.'],
  [
    'OnBecameVisible',
    '',
    'Called when the renderer became visible by any camera.',
    { coroutine: true }
  ],
  [
    'OnBecameInvisible',
    '',
    'Called when the renderer is no longer visible by any camera.',
    { coroutine: true }
  ],
  [
    'OnCollisionEnter',
    'Collision collision',
    'Called when this collider/rigidbody begins touching another rigidbody/collider.',
    { optionalParameters: true, coroutine: true }
  ],
  [
    'OnCollisionStay',
    'Collision collision',
    'Called once per physics update for every collider/rigidbody touching another.',
    { optionalParameters: true, coroutine: true, perf: true }
  ],
  [
    'OnCollisionExit',
    'Collision collision',
    'Called when this collider/rigidbody stops touching another rigidbody/collider.',
    { optionalParameters: true, coroutine: true }
  ],
  [
    'OnCollisionEnter2D',
    'Collision2D collision',
    'Sent when an incoming collider makes contact with this 2D collider.',
    { optionalParameters: true, coroutine: true }
  ],
  [
    'OnCollisionStay2D',
    'Collision2D collision',
    'Sent each frame where a collider on another object is touching this 2D collider.',
    { optionalParameters: true, coroutine: true, perf: true }
  ],
  [
    'OnCollisionExit2D',
    'Collision2D collision',
    'Sent when a collider on another object stops touching this 2D collider.',
    { optionalParameters: true, coroutine: true }
  ],
  [
    'OnTriggerEnter',
    'Collider other',
    'Called when a Collider enters the trigger.',
    { coroutine: true }
  ],
  [
    'OnTriggerStay',
    'Collider other',
    'Called once per physics update for every Collider touching the trigger.',
    { coroutine: true, perf: true }
  ],
  [
    'OnTriggerExit',
    'Collider other',
    'Called when a Collider has stopped touching the trigger.',
    { coroutine: true }
  ],
  [
    'OnTriggerEnter2D',
    'Collider2D other',
    'Sent when another 2D collider enters a trigger collider attached to this object.',
    { coroutine: true }
  ],
  [
    'OnTriggerStay2D',
    'Collider2D other',
    'Sent each frame where another 2D collider is overlapping this trigger.',
    { coroutine: true, perf: true }
  ],
  [
    'OnTriggerExit2D',
    'Collider2D other',
    'Sent when another 2D collider leaves a trigger collider attached to this object.',
    { coroutine: true }
  ],
  [
    'OnControllerColliderHit',
    'ControllerColliderHit hit',
    'Called when the CharacterController hits a collider while performing a Move.'
  ],
  [
    'OnJointBreak',
    'float breakForce',
    'Called when a joint attached to the same GameObject broke.'
  ],
  [
    'OnJointBreak2D',
    'Joint2D brokenJoint',
    'Called when a Joint2D attached to the same GameObject breaks.'
  ],
  ['OnParticleCollision', 'GameObject other', 'Called when a particle hits a Collider.'],
  ['OnParticleTrigger', '', 'Called when particles meet the conditions of the trigger module.'],
  [
    'OnParticleSystemStopped',
    '',
    'Called when all particles in the system have died and no new ones will be born.'
  ],
  [
    'OnParticleUpdateJobScheduled',
    '',
    'Called when a particle system update job has been scheduled.'
  ],
  [
    'OnMouseDown',
    '',
    'Called when the user pressed the mouse button over the Collider.',
    { coroutine: true }
  ],
  [
    'OnMouseDrag',
    '',
    'Called when the user clicked on a Collider and is still holding the mouse down.',
    { coroutine: true }
  ],
  ['OnMouseEnter', '', 'Called when the mouse enters the Collider.', { coroutine: true }],
  ['OnMouseExit', '', 'Called when the mouse is no longer over the Collider.', { coroutine: true }],
  [
    'OnMouseOver',
    '',
    'Called every frame while the mouse is over the Collider.',
    { coroutine: true }
  ],
  ['OnMouseUp', '', 'Called when the user has released the mouse button.', { coroutine: true }],
  [
    'OnMouseUpAsButton',
    '',
    'Called when the mouse is released over the same Collider it was pressed on.',
    { coroutine: true }
  ],
  [
    'OnGUI',
    '',
    'Called for rendering and handling IMGUI events, possibly several times per frame.',
    { perf: true }
  ],
  ['OnDrawGizmos', '', 'Editor-only: draw gizmos that are always drawn and pickable.'],
  ['OnDrawGizmosSelected', '', 'Editor-only: draw gizmos only when the object is selected.'],
  ['OnRenderObject', '', 'Called after the camera has rendered the scene.', { perf: true }],
  [
    'OnWillRenderObject',
    '',
    'Called for each camera if the object is visible and not a UI element.',
    { perf: true }
  ],
  ['OnPreCull', '', 'Built-in pipeline: called before the camera culls the scene.', { perf: true }],
  [
    'OnPreRender',
    '',
    'Built-in pipeline: called before the camera starts rendering the scene.',
    { perf: true }
  ],
  [
    'OnPostRender',
    '',
    'Built-in pipeline: called after the camera finishes rendering the scene.',
    { perf: true }
  ],
  [
    'OnRenderImage',
    'RenderTexture source, RenderTexture destination',
    'Built-in pipeline: post-process the rendered image.',
    { perf: true }
  ],
  [
    'OnAnimatorMove',
    '',
    'Callback for processing animation movements to modify root motion.',
    { perf: true }
  ],
  [
    'OnAnimatorIK',
    'int layerIndex',
    'Callback for setting up animation IK (inverse kinematics).',
    { perf: true }
  ],
  [
    'OnAudioFilterRead',
    'float[] data, int channels',
    'Audio-thread callback to implement a custom audio filter.',
    { perf: true }
  ],
  ['OnTransformChildrenChanged', '', 'Called when the list of children of the transform changes.'],
  ['OnTransformParentChanged', '', 'Called when the parent of the transform changes.'],
  [
    'OnBeforeTransformParentChanged',
    '',
    'Called just before the parent of the transform changes.',
    { undocumented: true }
  ],
  [
    'OnRectTransformDimensionsChange',
    '',
    'Called when the dimensions of the RectTransform change.',
    { undocumented: true }
  ],
  [
    'OnCanvasGroupChanged',
    '',
    'Called when the state of a parent CanvasGroup changes.',
    { undocumented: true }
  ],
  [
    'OnCanvasHierarchyChanged',
    '',
    'Called when the state of the parent Canvas changes.',
    { undocumented: true }
  ],
  [
    'OnDidApplyAnimationProperties',
    '',
    'Called after an animation has modified serialized properties.',
    { undocumented: true }
  ]
])
