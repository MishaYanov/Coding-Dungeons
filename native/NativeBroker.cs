using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Text.RegularExpressions;
using System.Threading;

internal static class NativeBroker
{
    private const int BrokerFault = 126;
    private const uint CompilerTimeoutMs = 17000;
    private static volatile bool canceled;

    private static int Main(string[] args)
    {
        if (args.Length == 0) return BrokerFault;
        if (args[0] == "probe") return SandboxProbe.Run(args);
        var pipe = new Thread(delegate() {
            try { Console.OpenStandardInput().ReadByte(); }
            catch (IOException) { }
            finally { canceled = true; }
        });
        pipe.IsBackground = true;
        pipe.Start();
        try
        {
            if (args.Length < 2) return BrokerFault;
            string directory = Path.GetFullPath(args[1]);
            RequireDirectory(directory);
            string assets = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            if (args.Length == 2)
            {
                switch (args[0])
                {
                    case "rust-compile": return Rust(assets, directory, false);
                    case "rust-link": return Rust(assets, directory, true);
                    case "go-compile": return Go(assets, directory);
                }
            }
            int index;
            if (args.Length == 3 && args[0] == "case"
                && int.TryParse(args[2], NumberStyles.None, CultureInfo.InvariantCulture, out index)
                && index >= 0 && index < 32) return RunCase(assets, directory, index);
            return BrokerFault;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return BrokerFault;
        }
    }

    private static int Rust(string assets, string directory, bool link)
    {
        string toolchain = Path.Combine(assets, "rust");
        string executable = Path.Combine(toolchain, "bin", "rustc.exe");
        RequireFile(executable);
        RequireFile(Path.Combine(directory, link ? "harness.rs" : "submission.rs"));
        var arguments = new List<string> {
            "--sysroot", toolchain, "--target", "wasm32-wasip1", "--edition=2024",
            "--color=never", "--error-format=short", "-Awarnings", "-Cpanic=abort", "-Cdebuginfo=0",
        };
        if (link)
        {
            string library = Path.Combine(directory, "libferrum_submission.rlib");
            string archive = Path.Combine(directory, "libferrum_harness.a");
            string linker = Path.Combine(toolchain, "wasm-linker.exe");
            string wasi = Path.Combine(toolchain, "lib", "rustlib", "wasm32-wasip1", "lib", "self-contained");
            RequireFile(library);
            RequireFile(linker);
            RequireDirectory(wasi);
            arguments.AddRange(new[] { "--crate-type=staticlib", "--crate-name=ferrum_harness",
                "--extern", "ferrum_submission=" + library, "-o", archive, "harness.rs" });

            // Keep both tools isolated. The broker starts LLD directly because
            // rustc's own subprocess setup can fail inside an AppContainer.
            int compiled = Compile(toolchain, executable, arguments.ToArray(), directory, null);
            if (compiled != 0) return compiled;
            RequireFile(archive);
            return Compile(toolchain, linker, new[] {
                "-flavor", "wasm", "--export=coding_dungeons_run_case", "-z", "stack-size=1048576",
                "--stack-first", "--no-demangle", "--gc-sections", "--no-entry", "-O0",
                archive, "-L", wasi, "-lc", "-o", "trial.wasm",
            }, directory, null, logName: "lld");
        }
        arguments.AddRange(new[] { "--crate-type=rlib", "--crate-name=ferrum_submission",
            "-o", "libferrum_submission.rlib", "submission.rs" });
        return Compile(toolchain, executable, arguments.ToArray(), directory, null);
    }

    private static int Go(string assets, string directory)
    {
        string toolchain = Path.Combine(assets, "go");
        string tools = Path.Combine(toolchain, "pkg", "tool", "windows_amd64");
        string compiler = Path.Combine(tools, "compile.exe");
        string linker = Path.Combine(tools, "link.exe");
        RequireFile(compiler);
        RequireFile(linker);
        RequireFile(Path.Combine(directory, "submission.go"));
        RequireFile(Path.Combine(directory, "harness.go"));
        string imports = GoImportConfig(toolchain, directory);
        var environment = new SortedDictionary<string, string> {
            { "GOROOT", toolchain }, { "GOOS", "wasip1" }, { "GOARCH", "wasm" }, { "CGO_ENABLED", "0" },
            { "GOMAXPROCS", "2" },
        };
        int compiled = Compile(toolchain, compiler, new[] {
            "-p", "main", "-lang=go1.25", "-complete", "-pack", "-importcfg", imports, "-trimpath", directory,
            "-o", "trial.a", "submission.go", "harness.go",
        }, directory, environment);
        if (compiled != 0) return compiled;
        RequireFile(Path.Combine(directory, "trial.a"));
        return Compile(toolchain, linker, new[] {
            "-buildmode=c-shared", "-linkmode=internal", "-importcfg", imports, "-s", "-w", "-o", "trial.wasm", "trial.a",
        }, directory, environment, logName: "go-link");
    }

    private static string GoImportConfig(string toolchain, string directory)
    {
        string stdlib = Path.Combine(toolchain, "stdlib");
        RequireDirectory(stdlib);
        string packages = Path.Combine(stdlib, "packages.txt");
        RequireFile(packages);
        if (new FileInfo(packages).Length > 65536)
            throw new InvalidOperationException("The Go standard library index is too large.");

        string config = Path.Combine(directory, "imports.cfg");
        var packageNames = new HashSet<string>(StringComparer.Ordinal);
        using (var stream = new FileStream(config, FileMode.CreateNew, FileAccess.Write))
        using (var writer = new StreamWriter(stream))
        {
            foreach (string row in File.ReadLines(packages))
            {
                var entry = Regex.Match(row, @"\A([a-zA-Z0-9_./-]+) ([0-9]{4}\.a)\z");
                if (!entry.Success || !packageNames.Add(entry.Groups[1].Value))
                    throw new InvalidOperationException("The Go standard library index is invalid.");
                string archive = Path.Combine(stdlib, entry.Groups[2].Value);
                RequireFile(archive);
                writer.WriteLine("packagefile " + entry.Groups[1].Value + "=" + archive);
            }
            if (!packageNames.Contains("runtime"))
                throw new InvalidOperationException("The Go standard library index is incomplete.");
        }
        return config;
    }

    private static int Compile(string toolchain, string executable, string[] arguments, string directory,
        SortedDictionary<string, string> environment, string logName = null)
    {
        RequireDirectory(toolchain);
        using (var profile = new WindowsSandbox.Profile())
        {
            WindowsSandbox.SetLowIntegrity(directory);
            profile.AllowDirectory(directory, FileSystemRights.Modify, true);
            profile.AllowDirectory(toolchain, FileSystemRights.ReadAndExecute, true);
            return WindowsSandbox.Run(profile, executable, arguments, directory, CompilerTimeoutMs,
                memoryMiB: 640, extraEnvironment: environment,
                logPath: Path.Combine(Path.GetDirectoryName(directory), (logName ?? Path.GetFileName(directory)) + ".log"),
                canceled: delegate { return canceled; });
        }
    }

    private static int RunCase(string assets, string directory, int index)
    {
        string worker = Path.Combine(assets, "wasm-worker");
        string executable = Path.Combine(worker, "wasm-worker.exe");
        string artifact = Path.Combine(directory, "trial.wasm");
        RequireDirectory(worker);
        RequireFile(executable);
        RequireFile(artifact);
        using (var profile = new WindowsSandbox.Profile())
        {
            profile.AllowDirectory(worker, FileSystemRights.ReadAndExecute, true);
            profile.AllowDirectory(directory, FileSystemRights.ReadAndExecute);
            profile.AllowFile(artifact, FileSystemRights.Read);
            return WindowsSandbox.Run(profile, executable, new[] { artifact, index.ToString(CultureInfo.InvariantCulture) },
                directory, 4500, 1, 512, canceled: delegate { return canceled; });
        }
    }

    private static void RequireDirectory(string path)
    {
        if (!Directory.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("A required sandbox directory is unavailable.");
    }

    private static void RequireFile(string path)
    {
        if (!File.Exists(path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("A required sandbox file is unavailable.");
    }
}
