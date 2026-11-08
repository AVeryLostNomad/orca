using System;
using UnityEditor;
using UnityEditor.PackageManager;

namespace StablyAI.Orca.Ide
{
    [Flags]
    internal enum OrcaProjectSources
    {
        None = 0,
        Embedded = 1 << 0,
        Local = 1 << 1,
        Registry = 1 << 2,
        Git = 1 << 3,
        BuiltIn = 1 << 4,
        LocalTarball = 1 << 5,
        Unknown = 1 << 6,
        PlayerProjects = 1 << 7
    }

    /// <summary>Per-user choice of which package sources get their own .csproj (EditorPrefs).</summary>
    internal static class OrcaProjectGenerationSettings
    {
        const string k_SourcesKey = "StablyAI.Orca.Ide.ProjectSources";
        // Editable packages get projects; immutable ones are referenced as compiled DLLs, like the Rider/VS packages.
        const OrcaProjectSources k_Default = OrcaProjectSources.Embedded | OrcaProjectSources.Local;

        internal static OrcaProjectSources Sources
        {
            get => (OrcaProjectSources)EditorPrefs.GetInt(k_SourcesKey, (int)k_Default);
            set => EditorPrefs.SetInt(k_SourcesKey, (int)value);
        }

        internal static bool Has(OrcaProjectSources flag) => (Sources & flag) == flag;

        internal static bool GeneratesProjectsFor(PackageSource source)
        {
            switch (source)
            {
                case PackageSource.Embedded: return Has(OrcaProjectSources.Embedded);
                case PackageSource.Local: return Has(OrcaProjectSources.Local);
                case PackageSource.Registry: return Has(OrcaProjectSources.Registry);
                case PackageSource.Git: return Has(OrcaProjectSources.Git);
                case PackageSource.BuiltIn: return Has(OrcaProjectSources.BuiltIn);
                case PackageSource.LocalTarball: return Has(OrcaProjectSources.LocalTarball);
                default: return Has(OrcaProjectSources.Unknown);
            }
        }
    }
}
