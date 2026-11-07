using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.AccessControl;
using System.Threading;

internal static class SandboxProbe
{
    private static int Main(string[] args) { return Run(args); }

    internal static int Run(string[] args)
    {
        try
        {
            if ((args.Length == 1 || args.Length == 2) && args[0] == "probe")
                return Probe(args.Length == 2 ? args[1] : null);
            if (args.Length == 5 && args[0] == "guest") return CheckIsolation(args[1], args[2], args[3], int.Parse(args[4]));
            if (args.Length == 1 && args[0] == "hang") Thread.Sleep(Timeout.Infinite);
            if (args.Length == 1 && args[0] == "noop") return 0;
            return 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 2;
        }
    }

    private static int Probe(string scratch)
    {
        string executable = Assembly.GetExecutingAssembly().Location;
        string assemblyDirectory = Path.GetDirectoryName(executable);
        string directory = scratch ?? assemblyDirectory;
        string input = Path.Combine(directory, "input.txt");
        string secret = Path.Combine(directory, "private.txt");

        using (var profile = new WindowsSandbox.Profile())
        {
            WriteNew(input, "trial input");
            WriteNew(secret, "protected canary");
            string writable = Path.Combine(directory, "compiler-scratch");
            Directory.CreateDirectory(writable);
            WindowsSandbox.SetLowIntegrity(writable);
            profile.AllowDirectory(directory, FileSystemRights.ReadAndExecute);
            if (assemblyDirectory != directory) profile.AllowDirectory(assemblyDirectory, FileSystemRights.ReadAndExecute);
            profile.AllowDirectory(writable, FileSystemRights.Modify, true);
            profile.AllowFile(executable, FileSystemRights.ReadAndExecute);
            profile.AllowFile(input, FileSystemRights.Read);
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try
            {
                var port = ((IPEndPoint)listener.LocalEndpoint).Port;
                string log = Path.Combine(directory, "probe.log");
                int verdict = WindowsSandbox.Run(profile, executable, new[] { "guest", input, secret, writable, port.ToString() },
                    directory, 8000, logPath: log);
                if (verdict != 0) throw new InvalidOperationException("The restricted process did not pass the isolation probe (exit " + verdict + ").");
                if (listener.Pending()) throw new InvalidOperationException("The restricted process reached loopback.");
                if (File.ReadAllText(Path.Combine(writable, "written.txt")) != "trial output")
                    throw new InvalidOperationException("The restricted compiler scratch was not writable.");
                if (File.ReadAllText(log).Trim() != "probe output")
                    throw new InvalidOperationException("The restricted compiler output handle was not available.");
            }
            finally { listener.Stop(); }

            int timeout = WindowsSandbox.Run(profile, executable, new[] { "hang" }, directory, 300);
            if (timeout != 124) throw new InvalidOperationException("The job did not enforce the probe timeout.");
        }

        Console.WriteLine("LPAC, file isolation, loopback denial, and job cleanup verified.");
        return 0;
    }

    private static void WriteNew(string path, string text)
    {
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
        using (var writer = new StreamWriter(stream)) writer.Write(text);
    }

    private static int CheckIsolation(string input, string secret, string writable, int port)
    {
        if (File.ReadAllText(input) != "trial input") return 10;
        try { File.ReadAllText(secret); return 11; }
        catch (UnauthorizedAccessException) { }

        string intermediate = Path.Combine(writable, "temporary.txt");
        WriteNew(intermediate, "trial output");
        File.Move(intermediate, Path.Combine(writable, "written.txt"));

        try
        {
            using (var client = new TcpClient()) client.Connect(IPAddress.Loopback, port);
            return 12;
        }
        catch (SocketException) { }

        try
        {
            var launch = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location, "noop") { UseShellExecute = false };
            using (Process child = Process.Start(launch)) { if (child != null) child.WaitForExit(); }
            return 13;
        }
        catch (Win32Exception) { }
        Console.WriteLine("probe output");
        return 0;
    }
}
