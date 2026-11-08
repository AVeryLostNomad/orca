using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Unity.CodeEditor;

namespace StablyAI.Orca.Ide
{
    /// <summary>Finds Orca installs and the CLI launcher that belongs to each.</summary>
    internal static class OrcaInstallations
    {
        // App executables and CLI launchers Orca ships (the Linux CLI is orca-ide: GNOME owns /usr/bin/orca).
        static readonly string[] k_OrcaFileNames =
        {
            "Orca.exe", "orca.exe", "orca.cmd", "orca-dev.cmd", "Orca.app", "Orca", "orca-ide", "orca-dev"
        };

        static bool IsWindows => RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
        static bool IsMac => RuntimeInformation.IsOSPlatform(OSPlatform.OSX);

        static StringComparison PathComparison => IsWindows || IsMac ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

        internal static bool SamePath(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b))
                return false;
            return string.Equals(Normalize(a), Normalize(b), PathComparison);
        }

        static string Normalize(string path)
        {
            try
            {
                return Path.GetFullPath(path).TrimEnd('/', '\\');
            }
            catch (Exception)
            {
                return path;
            }
        }

        static bool Exists(string path) => !string.IsNullOrEmpty(path) && (File.Exists(path) || Directory.Exists(path));

        static IEnumerable<string> KnownLocations()
        {
            if (IsWindows)
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                yield return Path.Combine(localAppData, "Programs", "orca", "Orca.exe");
                yield return Path.Combine(programFiles, "Orca", "Orca.exe");
            }
            else if (IsMac)
            {
                yield return "/Applications/Orca.app";
                yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Personal), "Applications", "Orca.app");
            }
            else
            {
                yield return "/opt/Orca/orca-ide";
            }
        }

        internal static CodeEditor.Installation[] Discover(OrcaEditorConfig config)
        {
            var paths = new List<string>();
            if (config != null && Exists(config.appPath))
                paths.Add(config.appPath);
            foreach (var location in KnownLocations())
            {
                if (Exists(location) && !paths.Any(path => SamePath(path, location)))
                    paths.Add(location);
            }
            return paths.Select(path => new CodeEditor.Installation { Name = DisplayName(path, config), Path = path }).ToArray();
        }

        internal static string DisplayName(string path, OrcaEditorConfig config)
        {
            var isConfigured = config != null && SamePath(path, config.appPath);
            var fileName = Path.GetFileName(path.TrimEnd('/', '\\'));
            var isDev = fileName.StartsWith("orca-dev", StringComparison.OrdinalIgnoreCase);
            var version = isConfigured && !string.IsNullOrEmpty(config.version) ? $" {config.version}" : string.Empty;
            return isDev ? $"Orca (dev){version}" : $"Orca{version}";
        }

        internal static bool IsOrcaPath(string path, OrcaEditorConfig config)
        {
            if (string.IsNullOrEmpty(path))
                return false;
            if (config != null && (SamePath(path, config.appPath) || SamePath(path, config.cliPath)))
                return true;
            var fileName = Path.GetFileName(path.TrimEnd('/', '\\'));
            return k_OrcaFileNames.Any(name => string.Equals(name, fileName, PathComparison));
        }

        /// <summary>The CLI launcher for an install, or null when only the app can be launched.</summary>
        internal static string ResolveCli(string installPath, OrcaEditorConfig config)
        {
            var matchesConfig = config != null && (string.IsNullOrEmpty(installPath) || SamePath(installPath, config.appPath) || SamePath(installPath, config.cliPath));
            if (matchesConfig && File.Exists(config.cliPath))
                return config.cliPath;
            if (string.IsNullOrEmpty(installPath))
                return null;
            var trimmed = installPath.TrimEnd('/', '\\');
            var fileName = Path.GetFileName(trimmed);
            var directory = Path.GetDirectoryName(trimmed) ?? string.Empty;
            string candidate;
            if (fileName.EndsWith(".app", StringComparison.OrdinalIgnoreCase))
                candidate = Path.Combine(trimmed, "Contents", "Resources", "bin", "orca");
            else if (string.Equals(Path.GetFileName(directory), "bin", StringComparison.OrdinalIgnoreCase))
                candidate = trimmed;
            else if (string.Equals(fileName, "Orca.exe", StringComparison.OrdinalIgnoreCase))
                candidate = Path.Combine(directory, "resources", "bin", "orca.exe");
            else if (fileName == "orca-ide" || fileName == "Orca")
                candidate = Path.Combine(directory, "resources", "bin", "orca-ide");
            else
                candidate = trimmed;
            return File.Exists(candidate) ? candidate : null;
        }
    }
}
