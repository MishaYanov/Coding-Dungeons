using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.AccessControl;

internal static class SandboxProbe
{
    private static int Main(string[] args) { return Run(args); }

    internal static int Run(string[] args)
    {
        try
        {
            if ((args.Length == 1 || args.Length == 2) && args[0] == "probe")
                return Probe(args.Length == 2 ? args[1] : null);
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
        string assemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string executable = Path.Combine(assemblyDirectory, "sandbox-probe.exe");
        if (!File.Exists(executable) || (File.GetAttributes(executable) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("The native isolation test child is missing.");
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
                // Verify the listener works from outside the sandbox first.
                using (var client = new TcpClient())
                {
                    client.Connect(IPAddress.Loopback, port);
                    listener.AcceptTcpClient().Dispose();
                }
                string log = Path.Combine(directory, "probe.log");
                string output = Path.Combine(writable, "written.txt");
                int verdict = WindowsSandbox.Run(profile, executable,
                    new[] { "guest", input, secret, Path.Combine(writable, "temporary.txt"), output, port.ToString() },
                    directory, 8000, logPath: log);
                if (verdict != 0) throw new InvalidOperationException("The restricted process did not pass the isolation probe (exit " + verdict + ").");
                if (listener.Pending()) throw new InvalidOperationException("The restricted process reached loopback.");
                if (File.ReadAllText(output) != "trial output")
                    throw new InvalidOperationException("The restricted compiler scratch was not writable.");
                string observed = File.ReadAllText(log).Trim();
                if (observed == "probe output; Winsock initialization failed (10107)")
                    WindowsSandbox.VerifyNoLoopbackExemption(profile.Sid);
                else if (observed != "probe output")
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

}
