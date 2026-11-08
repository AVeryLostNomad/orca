using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace StablyAI.Orca.Ide
{
    /// <summary>
    /// Writes the .sln and legacy-format .csproj files Roslyn-based editors load: one project per
    /// compiled assembly whose sources are editable (Assets, plus the package sources chosen in
    /// preferences); every other assembly is referenced as its compiled DLL.
    /// </summary>
    internal sealed class OrcaProjectGenerator
    {
        const string k_CSharpProjectType = "FAE04EC0-301F-11D3-BF4B-00C04F79EFBC";
        const string k_PlayerSuffix = ".Player";

        static readonly string[] k_CompilationInputExtensions = { ".asmdef", ".asmref", ".rsp", ".dll" };

        readonly string m_ProjectDirectory;
        readonly string m_ProjectName;
        readonly Dictionary<string, bool> m_EditablePackageCache = new Dictionary<string, bool>();

        sealed class ProjectPart
        {
            public string Name;
            public Assembly Assembly;
            public bool IsPlayer;
        }

        internal OrcaProjectGenerator(string projectDirectory)
        {
            m_ProjectDirectory = projectDirectory.TrimEnd('/', '\\');
            m_ProjectName = Path.GetFileName(m_ProjectDirectory);
        }

        internal string SolutionPath => Path.Combine(m_ProjectDirectory, $"{m_ProjectName}.sln");

        internal bool SyncIfNeeded(IEnumerable<string> changedFiles, IEnumerable<string> reimportedFiles)
        {
            var needed = !File.Exists(SolutionPath)
                || changedFiles.Any(path => HasExtension(path, ".cs") || IsCompilationInput(path))
                || reimportedFiles.Any(IsCompilationInput);
            if (needed)
                Sync();
            return needed;
        }

        static bool HasExtension(string path, string extension) =>
            string.Equals(Path.GetExtension(path), extension, StringComparison.OrdinalIgnoreCase);

        static bool IsCompilationInput(string path) => k_CompilationInputExtensions.Any(extension => HasExtension(path, extension));

        /// <summary>Regenerates every project; returns the paths whose content changed.</summary>
        internal List<string> Sync()
        {
            m_EditablePackageCache.Clear();
            var parts = new List<ProjectPart>();
            AddParts(parts, CompilationPipeline.GetAssemblies(AssembliesType.Editor), false);
            if (OrcaProjectGenerationSettings.Has(OrcaProjectSources.PlayerProjects))
                AddParts(parts, CompilationPipeline.GetAssemblies(AssembliesType.PlayerWithoutTestAssemblies), true);

            var written = new List<string>();
            var projectNames = new Dictionary<string, string>();
            foreach (var part in parts)
                projectNames[Key(part.Assembly.name, part.IsPlayer)] = part.Name;
            foreach (var part in parts)
            {
                var path = Path.Combine(m_ProjectDirectory, $"{part.Name}.csproj");
                if (WriteIfChanged(path, ProjectText(part, projectNames)))
                    written.Add(path);
            }
            if (WriteIfChanged(SolutionPath, SolutionText(parts)))
                written.Add(SolutionPath);
            return written;
        }

        static string Key(string assemblyName, bool isPlayer) => (isPlayer ? "player:" : "editor:") + assemblyName;

        void AddParts(List<ProjectPart> parts, IEnumerable<Assembly> assemblies, bool isPlayer)
        {
            foreach (var assembly in assemblies)
            {
                if (assembly.sourceFiles.Any(IsEditableSource))
                    parts.Add(new ProjectPart { Name = assembly.name + (isPlayer ? k_PlayerSuffix : string.Empty), Assembly = assembly, IsPlayer = isPlayer });
            }
        }

        bool IsEditableSource(string assetPath)
        {
            if (!assetPath.StartsWith("Packages/", StringComparison.Ordinal))
                return true;
            var secondSlash = assetPath.IndexOf('/', "Packages/".Length);
            var packageRoot = secondSlash < 0 ? assetPath : assetPath.Substring(0, secondSlash);
            if (!m_EditablePackageCache.TryGetValue(packageRoot, out var editable))
            {
                var package = PackageInfo.FindForAssetPath(assetPath);
                editable = package == null || OrcaProjectGenerationSettings.GeneratesProjectsFor(package.source);
                m_EditablePackageCache[packageRoot] = editable;
            }
            return editable;
        }

        static bool WriteIfChanged(string path, string content)
        {
            if (File.Exists(path) && File.ReadAllText(path) == content)
                return false;
            File.WriteAllText(path, content, new UTF8Encoding(true));
            return true;
        }

        string ProjectGuid(string projectName)
        {
            using (var md5 = MD5.Create())
            {
                var hash = md5.ComputeHash(Encoding.UTF8.GetBytes($"{m_ProjectName}/{projectName}"));
                return new Guid(hash).ToString();
            }
        }

        /// <summary>Unity remaps relative Packages/ paths to their physical location inside GetFullPath.</summary>
        string ProjectRelative(string path)
        {
            var full = Path.GetFullPath(path.Replace('/', Path.DirectorySeparatorChar));
            var prefix = m_ProjectDirectory + Path.DirectorySeparatorChar;
            return full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ? full.Substring(prefix.Length) : full;
        }

        static string FullPath(string path) => Path.GetFullPath(path.Replace('/', Path.DirectorySeparatorChar));

        static string Escape(string text) => SecurityElement.Escape(text) ?? string.Empty;

        sealed class CompilerArguments
        {
            public readonly HashSet<string> Defines = new HashSet<string>();
            public readonly HashSet<string> References = new HashSet<string>();
            public readonly List<KeyValuePair<string, string>> Options = new List<KeyValuePair<string, string>>();
            public bool Unsafe;

            public IEnumerable<string> All(params string[] names) =>
                Options.Where(option => names.Contains(option.Key)).Select(option => option.Value);
        }

        string ProjectText(ProjectPart part, Dictionary<string, string> projectNames)
        {
            var assembly = part.Assembly;
            var options = assembly.compilerOptions;
            var args = ReadResponseFiles(assembly);
            var defines = new HashSet<string>(assembly.defines);
            defines.UnionWith(args.Defines);
            var langVersion = args.All("langversion").LastOrDefault() ?? options.LanguageVersion;
            var nullable = args.All("nullable").LastOrDefault();
            var noWarn = args.All("nowarn").SelectMany(value => value.Split(',', ';')).Select(code => code.Trim()).ToList();
            if (PlayerSettings.suppressCommonWarnings)
                noWarn.AddRange(new[] { "0169", "0649" });

            var text = new StringBuilder();
            text.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>")
                .AppendLine("<Project ToolsVersion=\"4.0\" DefaultTargets=\"Build\" xmlns=\"http://schemas.microsoft.com/developer/msbuild/2003\">")
                .AppendLine("  <PropertyGroup>")
                .Append("    <LangVersion>").Append(Escape(langVersion)).AppendLine("</LangVersion>")
                // Keeps MSBuild from probing for .NET Framework reference assemblies; every reference is explicit below.
                .AppendLine("    <_TargetFrameworkDirectories>non_empty_path_generated_by_orca</_TargetFrameworkDirectories>")
                .AppendLine("    <_FullFrameworkReferenceAssemblyPaths>non_empty_path_generated_by_orca</_FullFrameworkReferenceAssemblyPaths>")
                .AppendLine("    <DisableHandlePackageFileConflicts>true</DisableHandlePackageFileConflicts>");
            foreach (var ruleset in args.All("ruleset").Append(options.RoslynAnalyzerRulesetPath).Where(path => !string.IsNullOrEmpty(path)).Distinct())
                text.Append("    <CodeAnalysisRuleSet>").Append(Escape(FullPath(ruleset))).AppendLine("</CodeAnalysisRuleSet>");
            text.AppendLine("  </PropertyGroup>")
                .AppendLine("  <PropertyGroup>")
                .AppendLine("    <Configuration Condition=\" '$(Configuration)' == '' \">Debug</Configuration>")
                .AppendLine("    <Platform Condition=\" '$(Platform)' == '' \">AnyCPU</Platform>")
                .AppendLine("    <ProductVersion>10.0.20506</ProductVersion>")
                .AppendLine("    <SchemaVersion>2.0</SchemaVersion>")
                .Append("    <RootNamespace>").Append(Escape(assembly.rootNamespace)).AppendLine("</RootNamespace>")
                .Append("    <ProjectGuid>{").Append(ProjectGuid(part.Name)).AppendLine("}</ProjectGuid>")
                .AppendLine("    <OutputType>Library</OutputType>")
                .Append("    <AssemblyName>").Append(Escape(assembly.name)).AppendLine("</AssemblyName>")
                .AppendLine("    <TargetFrameworkVersion>v4.7.1</TargetFrameworkVersion>")
                .AppendLine("    <FileAlignment>512</FileAlignment>")
                .AppendLine("    <BaseDirectory>.</BaseDirectory>")
                .AppendLine("  </PropertyGroup>")
                .AppendLine("  <PropertyGroup Condition=\" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' \">")
                .AppendLine("    <DebugSymbols>true</DebugSymbols>")
                .AppendLine("    <DebugType>full</DebugType>")
                .AppendLine("    <Optimize>false</Optimize>")
                .Append("    <OutputPath>Temp\\Bin\\Debug\\").Append(Escape(part.Name)).AppendLine("\\</OutputPath>")
                .Append("    <DefineConstants>").Append(Escape(string.Join(";", defines))).AppendLine("</DefineConstants>")
                .AppendLine("    <ErrorReport>prompt</ErrorReport>")
                .AppendLine("    <WarningLevel>4</WarningLevel>")
                .Append("    <NoWarn>").Append(Escape(string.Join(",", noWarn.Where(code => code.Length > 0).Distinct()))).AppendLine("</NoWarn>")
                .Append("    <AllowUnsafeBlocks>").Append(options.AllowUnsafeCode || args.Unsafe ? "True" : "False").AppendLine("</AllowUnsafeBlocks>")
                .AppendLine("    <TreatWarningsAsErrors>False</TreatWarningsAsErrors>");
            if (!string.IsNullOrEmpty(nullable))
                text.Append("    <Nullable>").Append(Escape(nullable)).AppendLine("</Nullable>");
            text.AppendLine("  </PropertyGroup>")
                .AppendLine("  <PropertyGroup>")
                .AppendLine("    <NoConfig>true</NoConfig>")
                .AppendLine("    <NoStdLib>true</NoStdLib>")
                .AppendLine("    <AddAdditionalExplicitAssemblyReferences>false</AddAdditionalExplicitAssemblyReferences>")
                .AppendLine("    <ImplicitlyExpandNETStandardFacades>false</ImplicitlyExpandNETStandardFacades>")
                .AppendLine("    <ImplicitlyExpandDesignTimeFacades>false</ImplicitlyExpandDesignTimeFacades>")
                .AppendLine("  </PropertyGroup>");

            AppendItems(text, "Analyzer", Analyzers(options, args));
            AppendItems(text, "AdditionalFiles", AdditionalFiles(options, args));
            AppendItems(text, "GlobalAnalyzerConfigFiles", AnalyzerConfig(options));

            text.AppendLine("  <ItemGroup>");
            foreach (var source in assembly.sourceFiles)
                text.Append("    <Compile Include=\"").Append(Escape(ProjectRelative(source))).AppendLine("\" />");
            var binaryReferences = new HashSet<string>(assembly.compiledAssemblyReferences.Select(FullPath), StringComparer.OrdinalIgnoreCase);
            binaryReferences.UnionWith(args.References.Select(FullPath));
            var projectReferences = new List<string>();
            foreach (var reference in assembly.assemblyReferences)
            {
                if (projectNames.TryGetValue(Key(reference.name, part.IsPlayer), out var projectName))
                    projectReferences.Add(projectName);
                else
                    binaryReferences.Add(FullPath(reference.outputPath));
            }
            foreach (var reference in binaryReferences)
            {
                text.Append("    <Reference Include=\"").Append(Escape(Path.GetFileNameWithoutExtension(reference))).AppendLine("\">")
                    .Append("      <HintPath>").Append(Escape(reference)).AppendLine("</HintPath>")
                    .AppendLine("    </Reference>");
            }
            text.AppendLine("  </ItemGroup>");
            if (projectReferences.Count > 0)
            {
                text.AppendLine("  <ItemGroup>");
                foreach (var projectName in projectReferences)
                {
                    text.Append("    <ProjectReference Include=\"").Append(Escape(projectName)).AppendLine(".csproj\">")
                        .Append("      <Project>{").Append(ProjectGuid(projectName)).AppendLine("}</Project>")
                        .Append("      <Name>").Append(Escape(projectName)).AppendLine("</Name>")
                        .AppendLine("    </ProjectReference>");
                }
                text.AppendLine("  </ItemGroup>");
            }
            text.AppendLine("  <Import Project=\"$(MSBuildToolsPath)\\Microsoft.CSharp.targets\" />")
                .AppendLine("</Project>");
            return text.ToString();
        }

        static void AppendItems(StringBuilder text, string itemType, IEnumerable<string> paths)
        {
            var items = paths.ToList();
            if (items.Count == 0)
                return;
            text.AppendLine("  <ItemGroup>");
            foreach (var path in items)
                text.Append("    <").Append(itemType).Append(" Include=\"").Append(Escape(path)).AppendLine("\" />");
            text.AppendLine("  </ItemGroup>");
        }

        static IEnumerable<string> Analyzers(ScriptCompilerOptions options, CompilerArguments args)
        {
            // Unity passes analyzers labeled "RoslynAnalyzer" to the compiler but not always through RoslynAnalyzerDllPaths.
            var labeled = PluginImporter.GetAllImporters()
                .Where(importer => !importer.isNativePlugin && AssetDatabase.GetLabels(importer).Contains("RoslynAnalyzer"))
                .Select(importer => importer.assetPath);
            return args.All("analyzer", "a")
                .SelectMany(value => value.Split(';'))
                .Concat(options.RoslynAnalyzerDllPaths ?? Array.Empty<string>())
                .Concat(labeled)
                .Where(path => !string.IsNullOrEmpty(path))
                .Select(FullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }

        static IEnumerable<string> AdditionalFiles(ScriptCompilerOptions options, CompilerArguments args)
        {
            var fromPipeline = Array.Empty<string>();
#if UNITY_2022_2_OR_NEWER
            fromPipeline = options.RoslynAdditionalFilePaths ?? Array.Empty<string>();
#endif
            return args.All("additionalfile")
                .SelectMany(value => value.Split(';'))
                .Concat(fromPipeline)
                .Where(path => !string.IsNullOrEmpty(path))
                .Select(FullPath)
                .Distinct(StringComparer.OrdinalIgnoreCase);
        }

        // ScriptCompilerOptions.AnalyzerConfigPath is missing from some 2021.3 patch releases.
        static IEnumerable<string> AnalyzerConfig(ScriptCompilerOptions options)
        {
            var path = typeof(ScriptCompilerOptions).GetProperty("AnalyzerConfigPath")?.GetValue(options) as string;
            return string.IsNullOrEmpty(path) ? Enumerable.Empty<string>() : new[] { FullPath(path) };
        }

        CompilerArguments ReadResponseFiles(Assembly assembly)
        {
            var args = new CompilerArguments();
            var options = assembly.compilerOptions;
            if (options.ResponseFiles == null || options.ResponseFiles.Length == 0)
                return args;
            var systemDirectories = CompilationPipeline.GetSystemAssemblyDirectories(options.ApiCompatibilityLevel);
            foreach (var responseFile in options.ResponseFiles)
            {
                var data = CompilationPipeline.ParseResponseFile(responseFile, m_ProjectDirectory, systemDirectories);
                foreach (var error in data.Errors)
                    Debug.LogWarning($"[Orca] {responseFile}: {error}");
                args.Defines.UnionWith(data.Defines);
                args.References.UnionWith(data.FullPathReferences);
                args.Unsafe |= data.Unsafe;
                foreach (var argument in data.OtherArguments)
                {
                    if (argument.Length < 2 || (argument[0] != '-' && argument[0] != '/'))
                        continue;
                    var separator = argument.IndexOf(':');
                    var name = (separator > 0 ? argument.Substring(1, separator - 1) : argument.Substring(1)).ToLowerInvariant();
                    var value = separator > 0 ? argument.Substring(separator + 1) : string.Empty;
                    if (name == "nullable" || name == "nullable+" || name == "nullable-")
                    {
                        value = name == "nullable-" || value == "-" ? "disable" : value.Length == 0 || value == "+" ? "enable" : value;
                        name = "nullable";
                    }
                    args.Options.Add(new KeyValuePair<string, string>(name, value));
                }
            }
            return args;
        }

        string SolutionText(List<ProjectPart> parts)
        {
            var text = new StringBuilder();
            text.AppendLine()
                .AppendLine("Microsoft Visual Studio Solution File, Format Version 11.00")
                .AppendLine("# Visual Studio 2010");
            foreach (var part in parts)
            {
                text.Append("Project(\"{").Append(k_CSharpProjectType).Append("}\") = \"").Append(part.Name).Append("\", \"")
                    .Append(part.Name).Append(".csproj\", \"{").Append(ProjectGuid(part.Name)).AppendLine("}\"")
                    .AppendLine("EndProject");
            }
            text.AppendLine("Global")
                .AppendLine("\tGlobalSection(SolutionConfigurationPlatforms) = preSolution")
                .AppendLine("\t\tDebug|Any CPU = Debug|Any CPU")
                .AppendLine("\tEndGlobalSection")
                .AppendLine("\tGlobalSection(ProjectConfigurationPlatforms) = postSolution");
            foreach (var part in parts)
            {
                var guid = ProjectGuid(part.Name);
                text.Append("\t\t{").Append(guid).AppendLine("}.Debug|Any CPU.ActiveCfg = Debug|Any CPU")
                    .Append("\t\t{").Append(guid).AppendLine("}.Debug|Any CPU.Build.0 = Debug|Any CPU");
            }
            text.AppendLine("\tEndGlobalSection")
                .AppendLine("\tGlobalSection(SolutionProperties) = preSolution")
                .AppendLine("\t\tHideSolutionNode = FALSE")
                .AppendLine("\tEndGlobalSection")
                .AppendLine("EndGlobal");
            return text.ToString();
        }
    }
}
