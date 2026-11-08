import { messagesOf } from './unity-event-function-types'

// ScriptableObject-family and editor-scripting messages.
export const SCRIPTABLE_OBJECT_MESSAGES = messagesOf('ScriptableObject', [
  ['Awake', '', 'Called when the ScriptableObject instance is created.'],
  ['OnEnable', '', 'Called when the object is loaded.'],
  ['OnDisable', '', 'Called when the ScriptableObject goes out of scope.'],
  ['OnDestroy', '', 'Called when the ScriptableObject will be destroyed.'],
  [
    'OnValidate',
    '',
    'Editor-only: called when the script is loaded or a value changes in the Inspector.'
  ],
  ['Reset', '', 'Editor-only: resets to default values.']
])

export const EDITOR_MESSAGES = messagesOf('Editor', [
  ['OnSceneGUI', '', 'Lets the editor handle an event in the Scene view.'],
  [
    'HasFrameBounds',
    '',
    'Validates whether custom bounds can be computed for this editor.',
    { returns: 'bool' }
  ],
  [
    'OnGetFrameBounds',
    '',
    'Gets custom bounds for the target of this editor.',
    { returns: 'Bounds' }
  ]
])

export const EDITOR_WINDOW_MESSAGES = messagesOf('EditorWindow', [
  ['Awake', '', 'Called as the new window is opened.'],
  ['CreateGUI', '', 'Called once to build the window content with UI Toolkit.'],
  ['OnGUI', '', 'Implement your own IMGUI editor GUI here.'],
  ['Update', '', 'Called multiple times per second on all visible windows.'],
  ['OnFocus', '', 'Called when the window gets keyboard focus.'],
  ['OnLostFocus', '', 'Called when the window loses keyboard focus.'],
  [
    'OnHierarchyChange',
    '',
    'Handler for message sent when an object or group of objects in the hierarchy changes.'
  ],
  ['OnProjectChange', '', 'Handler for message sent whenever the state of the project changes.'],
  ['OnSelectionChange', '', 'Called whenever the selection has changed.'],
  [
    'OnInspectorUpdate',
    '',
    'Called at 10 frames per second to give the inspector a chance to update.'
  ],
  ['OnBecameVisible', '', 'Called after the window has been made visible.'],
  ['OnBecameInvisible', '', 'Called after the window has been removed from the screen.'],
  ['OnDestroy', '', 'Called when the EditorWindow is closed.'],
  ['OnDidOpenScene', '', 'Called when a scene is opened.', { undocumented: true }],
  ['OnAddedAsTab', '', 'Called when the window is added as a tab.', { undocumented: true }],
  [
    'OnBeforeRemovedAsTab',
    '',
    'Called before the window is removed as a tab.',
    { undocumented: true }
  ],
  [
    'OnTabDetached',
    '',
    'Called when the tab is dragged out of its dock area.',
    { undocumented: true }
  ],
  ['OnMainWindowMove', '', 'Called when the main editor window moves.', { undocumented: true }],
  ['ModifierKeysChanged', '', 'Called when modifier keys change.', { undocumented: true }],
  [
    'ShowButton',
    'Rect position',
    'Draw a custom button in the window tab header.',
    { undocumented: true }
  ]
])

export const ASSET_POSTPROCESSOR_MESSAGES = messagesOf('AssetPostprocessor', [
  ['OnPreprocessAsset', '', 'Called before importing any asset.'],
  ['OnPreprocessAnimation', '', 'Called before an animation from a model file is imported.'],
  ['OnPreprocessAudio', '', 'Called before an audio clip is imported.'],
  ['OnPreprocessModel', '', 'Called before a model is imported.'],
  ['OnPreprocessSpeedTree', '', 'Called before a SpeedTree asset is imported.'],
  ['OnPreprocessTexture', '', 'Called before a texture is imported.'],
  [
    'OnPreprocessCameraDescription',
    'CameraDescription description, Camera camera, AnimationClip[] animations',
    'Called for each camera imported from a model.'
  ],
  [
    'OnPreprocessLightDescription',
    'LightDescription description, Light light, AnimationClip[] animations',
    'Called for each light imported from a model.'
  ],
  [
    'OnPreprocessMaterialDescription',
    'MaterialDescription description, Material material, AnimationClip[] animations',
    'Called for each material imported from a model.'
  ],
  [
    'OnPostprocessAllAssets',
    'string[] importedAssets, string[] deletedAssets, string[] movedAssets, string[] movedFromAssetPaths',
    'Called after importing of any number of assets is complete.',
    {
      isStatic: true,
      alternatives: [
        'string[] importedAssets, string[] deletedAssets, string[] movedAssets, string[] movedFromAssetPaths, bool didDomainReload'
      ]
    }
  ],
  [
    'OnPostprocessAnimation',
    'GameObject root, AnimationClip clip',
    'Called when an AnimationClip has finished importing.'
  ],
  [
    'OnPostprocessAssetbundleNameChanged',
    'string assetPath, string previousAssetBundleName, string newAssetBundleName',
    'Called when an asset bundle name changes.'
  ],
  ['OnPostprocessAudio', 'AudioClip clip', 'Called after an audio clip has finished importing.'],
  [
    'OnPostprocessCubemap',
    'Cubemap texture',
    'Called after a cubemap texture has finished importing.'
  ],
  [
    'OnPostprocessGameObjectWithAnimatedUserProperties',
    'GameObject go, EditorCurveBinding[] bindings',
    'Called for each GameObject with animated custom properties.'
  ],
  [
    'OnPostprocessGameObjectWithUserProperties',
    'GameObject go, string[] propNames, object[] values',
    'Called for each GameObject that had user properties attached in the model.'
  ],
  ['OnPostprocessMaterial', 'Material material', 'Called after a material has been imported.'],
  [
    'OnPostprocessMeshHierarchy',
    'GameObject root',
    'Called for the root transform of each mesh hierarchy in an imported model.'
  ],
  ['OnPostprocessModel', 'GameObject g', 'Called after a model has been imported.'],
  ['OnPostprocessPrefab', 'GameObject root', 'Called after a prefab has been imported.'],
  ['OnPostprocessSpeedTree', 'GameObject go', 'Called after a SpeedTree asset has been imported.'],
  [
    'OnPostprocessSprites',
    'Texture2D texture, Sprite[] sprites',
    'Called after sprites have been generated for a texture.'
  ],
  ['OnPostprocessTexture', 'Texture2D texture', 'Called after a texture has been imported.'],
  [
    'OnPostprocessTexture2DArray',
    'Texture2DArray texture',
    'Called after a 2D texture array has been imported.'
  ],
  ['OnPostprocessTexture3D', 'Texture3D texture', 'Called after a 3D texture has been imported.'],
  [
    'OnAssignMaterialModel',
    'Material material, Renderer renderer',
    'Supply a material when the model importer assigns materials.',
    { returns: 'Material' }
  ],
  [
    'OnGeneratedCSProject',
    'string path, string content',
    'Rewrite a generated .csproj before it is written.',
    { isStatic: true, returns: 'string', undocumented: true }
  ],
  [
    'OnGeneratedSlnSolution',
    'string path, string content',
    'Rewrite a generated .sln before it is written.',
    { isStatic: true, returns: 'string', undocumented: true }
  ]
])
