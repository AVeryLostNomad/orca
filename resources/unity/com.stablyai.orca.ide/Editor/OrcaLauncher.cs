using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace StablyAI.Orca.Ide
{
    /// <summary>Opens files in Orca through its CLI, off the Unity main thread.</summary>
    internal static class OrcaLauncher
    {
        const int k_LaunchTimeoutMs = 60_000;
        const int k_CommandTimeoutMs = 20_000;

        internal sealed class Step
        {
            public string[] Args;
            /// <summary>Run <see cref="Fallback"/> then retry this step once when it fails.</summary>
            public string[][] Fallback = Array.Empty<string[]>();
        }

        /// <summary>
        /// CLI calls for opening a file (or just the project) in Orca: launch/attach, then open the file
        /// with cwd = project root so Orca infers the workspace; register the folder first if that fails.
        /// </summary>
        internal static List<Step> Plan(string projectRoot, string absoluteFile, int line, int column)
        {
            var addProject = new[] { "repo", "add", "--path", projectRoot };
            var steps = new List<Step> { new Step { Args = new[] { "open" } } };
            if (string.IsNullOrEmpty(absoluteFile))
            {
                steps.Add(new Step { Args = addProject });
                return steps;
            }
            var open = new List<string> { "file", "open", absoluteFile };
            if (line > 0)
            {
                open.Add("--line");
                open.Add(line.ToString());
                if (column > 0)
                {
                    open.Add("--column");
                    open.Add(column.ToString());
                }
            }
            open.Add("--focus");
            steps.Add(new Step { Args = open.ToArray(), Fallback = new[] { addProject } });
            return steps;
        }

        internal static bool Open(string installPath, OrcaEditorConfig config, string filePath, int line, int column)
        {
            var projectRoot = OrcaEditorConfig.ProjectRoot;
            var absoluteFile = string.IsNullOrEmpty(filePath) ? null : Path.GetFullPath(Path.Combine(projectRoot, filePath));
            var cli = OrcaInstallations.ResolveCli(installPath, config);
            if (cli == null)
                return LaunchApp(installPath, absoluteFile);
            var steps = Plan(projectRoot, absoluteFile, line, column);
            Task.Run(() => RunSteps(cli, projectRoot, steps));
            return true;
        }

        static void RunSteps(string cli, string projectRoot, List<Step> steps)
        {
            try
            {
                for (var index = 0; index < steps.Count; index++)
                {
                    var step = steps[index];
                    var timeout = index == 0 ? k_LaunchTimeoutMs : k_CommandTimeoutMs;
                    var result = Run(cli, step.Args, projectRoot, timeout);
                    if (result.ExitCode == 0)
                        continue;
                    if (step.Fallback.Length == 0)
                    {
                        Debug.LogWarning($"[Orca] `orca {string.Join(" ", step.Args)}` failed: {result.Output}");
                        continue;
                    }
                    foreach (var fallback in step.Fallback)
                        Run(cli, fallback, projectRoot, k_CommandTimeoutMs);
                    var retry = Run(cli, step.Args, projectRoot, k_CommandTimeoutMs);
                    if (retry.ExitCode != 0)
                        Debug.LogWarning($"[Orca] Could not open the file in Orca: {retry.Output}");
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Orca] Could not run the Orca CLI ({cli}): {exception.Message}");
            }
        }

        struct RunResult
        {
            public int ExitCode;
            public string Output;
        }

        static RunResult Run(string program, string[] args, string workingDirectory, int timeoutMs)
        {
            var arguments = JoinArguments(args);
            var extension = Path.GetExtension(program).ToLowerInvariant();
            // Batch launchers (dev builds' orca-dev.cmd) need cmd.exe; /s keeps the outer quotes literal.
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && (extension == ".cmd" || extension == ".bat"))
            {
                arguments = $"/d /s /c \"{QuoteWindows(program)} {arguments}\"";
                program = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
            }
            var startInfo = new ProcessStartInfo
            {
                FileName = program,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                    return new RunResult { ExitCode = -1, Output = "process did not start" };
                var output = new StringBuilder();
                process.OutputDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                process.ErrorDataReceived += (_, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                if (!process.WaitForExit(timeoutMs))
                    return new RunResult { ExitCode = -1, Output = $"timed out after {timeoutMs / 1000}s" };
                process.WaitForExit();
                lock (output)
                    return new RunResult { ExitCode = process.ExitCode, Output = output.ToString().Trim() };
            }
        }

        static bool LaunchApp(string installPath, string absoluteFile)
        {
            if (string.IsNullOrEmpty(installPath))
                return false;
            try
            {
                var target = absoluteFile ?? OrcaEditorConfig.ProjectRoot;
                var startInfo = RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
                    ? new ProcessStartInfo("open", JoinArguments(new[] { "-a", installPath, target }))
                    : new ProcessStartInfo(installPath, JoinArguments(new[] { target }));
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                Process.Start(startInfo)?.Dispose();
                return true;
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Orca] Could not launch Orca ({installPath}): {exception.Message}");
                return false;
            }
        }

        internal static string JoinArguments(IEnumerable<string> args)
        {
            Func<string, string> quote = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? QuoteWindows : (Func<string, string>)QuotePosix;
            return string.Join(" ", args.Select(quote));
        }

        // CommandLineToArgvW rules: backslashes double only before a quote.
        static string QuoteWindows(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
                return arg;
            var quoted = new StringBuilder("\"");
            var backslashes = 0;
            foreach (var character in arg)
            {
                if (character == '\\')
                {
                    backslashes++;
                    continue;
                }
                quoted.Append('\\', character == '"' ? backslashes * 2 + 1 : backslashes);
                backslashes = 0;
                quoted.Append(character);
            }
            quoted.Append('\\', backslashes * 2).Append('"');
            return quoted.ToString();
        }

        // Mono splits Arguments like a POSIX shell's double-quoted words.
        static string QuotePosix(string arg)
        {
            var escaped = new StringBuilder("\"");
            foreach (var character in arg)
            {
                if (character == '"' || character == '\\' || character == '$' || character == '`')
                    escaped.Append('\\');
                escaped.Append(character);
            }
            return escaped.Append('"').ToString();
        }
    }
}
