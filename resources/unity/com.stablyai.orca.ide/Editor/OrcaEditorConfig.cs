using System;
using System.IO;
using UnityEngine;

namespace StablyAI.Orca.Ide
{
    /// <summary>Library/Orca/orca-editor.json, written by Orca when it installs this package.</summary>
    [Serializable]
    internal sealed class OrcaEditorConfig
    {
        /// <summary>Executable registered as the External Script Editor (Orca app, or a dev build's CLI launcher).</summary>
        public string appPath;
        /// <summary>The `orca` CLI launcher matching appPath.</summary>
        public string cliPath;
        public string version;
        public bool autoSelect;

        internal static string ProjectRoot => Path.GetDirectoryName(Path.GetFullPath(Application.dataPath));

        internal static string ConfigPath => Path.Combine(ProjectRoot, "Library", "Orca", "orca-editor.json");

        internal static OrcaEditorConfig Load()
        {
            try
            {
                var path = ConfigPath;
                return File.Exists(path) ? JsonUtility.FromJson<OrcaEditorConfig>(File.ReadAllText(path)) : null;
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Orca] Ignoring unreadable {ConfigPath}: {exception.Message}");
                return null;
            }
        }
    }
}
