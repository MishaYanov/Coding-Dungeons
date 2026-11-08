using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
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
            RequireFile(library);
            arguments.AddRange(new[] { "--crate-type=cdylib", "--crate-name=ferrum_harness",
                "--extern", "ferrum_submission=" + library, "-o", "trial.wasm", "harness.rs" });
        }
        else arguments.AddRange(new[] { "--crate-type=rlib", "--crate-name=ferrum_submission",
            "-o", "libferrum_submission.rlib", "submission.rs" });
        return Compile(toolchain, executable, arguments.ToArray(), directory, null);
    }

    private static int Go(string assets, string directory)
    {
        string toolchain = Path.Combine(assets, "go");
        string executable = Path.Combine(toolchain, "bin", "go.exe");
        RequireFile(executable);
        RequireFile(Path.Combine(directory, "submission.go"));
        RequireFile(Path.Combine(directory, "harness.go"));
        string cache = Path.Combine(directory, "go-cache");
        Directory.CreateDirectory(cache);
        var environment = new SortedDictionary<string, string> {
            { "GOROOT", toolchain }, { "GOOS", "wasip1" }, { "GOARCH", "wasm" }, { "CGO_ENABLED", "0" },
            { "GOTOOLCHAIN", "local" }, { "GOENV", "off" }, { "GOPROXY", "off" }, { "GOSUMDB", "off" },
            { "GO111MODULE", "off" }, { "GOWORK", "off" }, { "GOMAXPROCS", "2" },
            { "GOPATH", Path.Combine(directory, "go-path") }, { "GOCACHE", cache },
        };
        return Compile(toolchain, executable, new[] { "build", "-buildmode=c-shared", "-p=1", "-trimpath", "-ldflags=-s -w",
            "-o", "trial.wasm", "submission.go", "harness.go" }, directory, environment);
    }

    private static int Compile(string toolchain, string executable, string[] arguments, string directory,
        SortedDictionary<string, string> environment)
    {
        RequireDirectory(toolchain);
        using (var profile = new WindowsSandbox.Profile())
        {
            WindowsSandbox.SetLowIntegrity(directory);
            profile.AllowDirectory(directory, FileSystemRights.Modify, true);
            profile.AllowDirectory(toolchain, FileSystemRights.ReadAndExecute, true);
            return WindowsSandbox.Run(profile, executable, arguments, directory, CompilerTimeoutMs,
                8, 640, environment, Path.Combine(Path.GetDirectoryName(directory), Path.GetFileName(directory) + ".log"),
                delegate { return canceled; });
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
