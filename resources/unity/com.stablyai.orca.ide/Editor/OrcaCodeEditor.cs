using System;
using System.IO;
using System.Linq;
using Unity.CodeEditor;
using UnityEditor;
using UnityEngine;

namespace StablyAI.Orca.Ide
{
    /// <summary>Registers Orca as an External Script Editor and selects it once per project when Orca asks.</summary>
    [InitializeOnLoad]
    internal sealed class OrcaCodeEditor : IExternalCodeEditor
    {
        const string k_AutoSelectedKeyPrefix = "StablyAI.Orca.Ide.AutoSelected:";

        // Files Orca edits as text; anything else falls back to the OS default app.
        static readonly string[] k_TextExtensions =
        {
            ".cs", ".shader", ".cginc", ".hlsl", ".hlslinc", ".glslinc", ".compute", ".raytrace", ".template",
            ".uss", ".uxml", ".tss", ".json", ".asmdef", ".asmref", ".rsp", ".txt", ".md", ".xml", ".yaml",
            ".yml", ".inputactions", ".shadergraph", ".shadersubgraph", ".csv", ".lua", ".js", ".ts"
        };

        static readonly OrcaCodeEditor s_Instance = new OrcaCodeEditor();

        string m_InstallationPath;
        OrcaProjectGenerator m_Generator;

        static OrcaCodeEditor()
        {
            CodeEditor.Register(s_Instance);
            // Not delayCall: an unfocused editor stops ticking, and Orca installs this while Unity is in the background.
            AutoSelectOnce();
        }

        OrcaProjectGenerator Generator => m_Generator ?? (m_Generator = new OrcaProjectGenerator(OrcaEditorConfig.ProjectRoot));

        public CodeEditor.Installation[] Installations => OrcaInstallations.Discover(OrcaEditorConfig.Load());

        public bool TryGetInstallationForPath(string editorPath, out CodeEditor.Installation installation)
        {
            var config = OrcaEditorConfig.Load();
            if (!OrcaInstallations.IsOrcaPath(editorPath, config))
            {
                installation = default;
                return false;
            }
            installation = new CodeEditor.Installation { Name = OrcaInstallations.DisplayName(editorPath, config), Path = editorPath };
            return true;
        }

        public void Initialize(string editorInstallationPath)
        {
            m_InstallationPath = editorInstallationPath;
        }

        public void OnGUI()
        {
            EditorGUILayout.LabelField("Generate .csproj files for:");
            EditorGUI.indentLevel++;
            var sources = OrcaProjectGenerationSettings.Sources;
            var updated = sources;
            updated = Toggle(updated, OrcaProjectSources.Embedded, "Embedded packages");
            updated = Toggle(updated, OrcaProjectSources.Local, "Local packages");
            updated = Toggle(updated, OrcaProjectSources.Registry, "Registry packages");
            updated = Toggle(updated, OrcaProjectSources.Git, "Git packages");
            updated = Toggle(updated, OrcaProjectSources.BuiltIn, "Built-in packages");
            updated = Toggle(updated, OrcaProjectSources.LocalTarball, "Local tarball");
            updated = Toggle(updated, OrcaProjectSources.Unknown, "Packages from unknown sources");
            updated = Toggle(updated, OrcaProjectSources.PlayerProjects, "Player projects");
            EditorGUI.indentLevel--;
            if (updated != sources)
                OrcaProjectGenerationSettings.Sources = updated;

            var rect = EditorGUI.IndentedRect(EditorGUILayout.GetControlRect());
            rect.width = 252;
            if (GUI.Button(rect, "Regenerate project files"))
                SyncAll();
        }

        static OrcaProjectSources Toggle(OrcaProjectSources sources, OrcaProjectSources flag, string label)
        {
            var enabled = EditorGUILayout.Toggle(label, (sources & flag) == flag);
            return enabled ? sources | flag : sources & ~flag;
        }

        public void SyncIfNeeded(string[] addedFiles, string[] deletedFiles, string[] movedFiles, string[] movedFromFiles, string[] importedFiles)
        {
            Generator.SyncIfNeeded(addedFiles.Concat(deletedFiles).Concat(movedFiles).Concat(movedFromFiles), importedFiles);
        }

        public void SyncAll()
        {
            AssetDatabase.Refresh();
            Generator.Sync();
        }

        public bool OpenProject(string filePath = "", int line = -1, int column = -1)
        {
            if (!string.IsNullOrEmpty(filePath) && !k_TextExtensions.Contains(Path.GetExtension(filePath).ToLowerInvariant()))
                return false;
            if (!File.Exists(Generator.SolutionPath))
                Generator.Sync();
            var installation = string.IsNullOrEmpty(m_InstallationPath) ? CodeEditor.CurrentEditorInstallation : m_InstallationPath;
            return OrcaLauncher.Open(installation, OrcaEditorConfig.Load(), filePath, line, column);
        }

        /// <summary>
        /// Honors Orca's `autoSelect` once per project: a user who later picks another editor keeps it.
        /// </summary>
        static void AutoSelectOnce()
        {
            var config = OrcaEditorConfig.Load();
            if (config == null || !config.autoSelect || string.IsNullOrEmpty(config.appPath))
                return;
            if (!File.Exists(config.appPath) && !Directory.Exists(config.appPath))
                return;
            var key = k_AutoSelectedKeyPrefix + OrcaEditorConfig.ProjectRoot.ToLowerInvariant();
            if (EditorPrefs.GetBool(key, false))
                return;
            EditorPrefs.SetBool(key, true);
            if (OrcaInstallations.IsOrcaPath(CodeEditor.CurrentEditorInstallation, config))
                return;
            try
            {
                CodeEditor.SetExternalScriptEditor(config.appPath);
                s_Instance.Initialize(config.appPath);
                s_Instance.Generator.Sync();
                Debug.Log($"[Orca] Orca is now the External Script Editor for this project. Change it under Preferences > External Tools.");
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Orca] Could not select Orca as the External Script Editor: {exception.Message}");
            }
        }
    }
}
