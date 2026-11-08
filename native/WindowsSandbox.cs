using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

// Developer probe for the native runner's Windows process boundary.
internal static class WindowsSandbox
{
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfo = 0x00080000;
    private const uint CreateNoWindow = 0x08000000;
    private const uint LimitActiveProcess = 0x00000008;
    private const uint LimitJobMemory = 0x00000200;
    private const uint KillOnJobClose = 0x00002000;
    private const int JobExtendedLimits = 9;
    private const int JobBasicAndIoAccounting = 8;
    private const int JobCpuRateControl = 15;
    private const uint CpuEnableHardCap = 0x5;
    private const uint TokenQuery = 0x0008;
    private const int TokenIsAppContainer = 29;
    private const int TokenCapabilities = 30;
    private const int TokenAppContainerSid = 31;
    private const int TokenIsLessPrivilegedAppContainer = 46;
    private const int SecurityCapabilitiesAttribute = 0x00020009;
    private const int JobListAttribute = 0x0002000d;
    private const int HandleListAttribute = 0x00020002;
    private const int ChildProcessPolicyAttribute = 0x0002000e;
    private const int AllPackagesPolicyAttribute = 0x0002000f;
    private const int PolicyEnabled = 1;
    private const uint WaitObject = 0;
    private const uint WaitTimeout = 258;

    internal sealed class Profile : IDisposable
    {
        private readonly string name = "CodingDungeons.Run." + Guid.NewGuid().ToString("N");
        internal IntPtr Sid { get; private set; }
        private readonly List<Action> cleanup = new List<Action>();

        internal Profile()
        {
            if (CallerIsAppContainer())
                throw new InvalidOperationException("The isolation probe requires a Windows desktop process outside an existing AppContainer.");
            IntPtr sid;
            int result = CreateAppContainerProfile(name, name, "Coding Dungeons isolation probe", IntPtr.Zero, 0, out sid);
            if (result < 0) throw new InvalidOperationException("CreateAppContainerProfile failed with HRESULT 0x" + result.ToString("X8") + ".");
            if (sid == IntPtr.Zero) throw new InvalidOperationException("Windows did not return an AppContainer SID.");
            Sid = sid;
        }

        internal void AllowFile(string path, FileSystemRights rights)
        {
            FileSecurity security = File.GetAccessControl(path);
            var rule = new FileSystemAccessRule(new SecurityIdentifier(Sid), rights, AccessControlType.Allow);
            security.AddAccessRule(rule);
            File.SetAccessControl(path, security);
            cleanup.Add(delegate {
                var current = File.GetAccessControl(path);
                current.RemoveAccessRuleSpecific(rule);
                File.SetAccessControl(path, current);
            });
        }

        internal void AllowDirectory(string path, FileSystemRights rights, bool inherited = false)
        {
            DirectorySecurity security = Directory.GetAccessControl(path);
            var inheritance = inherited ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
            var rule = new FileSystemAccessRule(new SecurityIdentifier(Sid), rights, inheritance, PropagationFlags.None, AccessControlType.Allow);
            security.AddAccessRule(rule);
            Directory.SetAccessControl(path, security);
            cleanup.Add(delegate {
                if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("The worker replaced a sandbox directory with a reparse point.");
                var current = Directory.GetAccessControl(path);
                current.RemoveAccessRuleSpecific(rule);
                Directory.SetAccessControl(path, current);
            });
        }

        public void Dispose()
        {
            if (Sid == IntPtr.Zero) return;
            Exception cleanupError = null;
            try
            {
                for (int i = cleanup.Count - 1; i >= 0; i--)
                {
                    try { cleanup[i](); }
                    catch (Exception error) { if (cleanupError == null) cleanupError = error; }
                }
            }
            finally
            {
                FreeSid(Sid);
                Sid = IntPtr.Zero;
                int result = DeleteAppContainerProfile(name);
                if (result < 0) throw new InvalidOperationException("DeleteAppContainerProfile failed with HRESULT 0x" + result.ToString("X8") + ".");
            }
            if (cleanupError != null) throw new InvalidOperationException("A sandbox access rule could not be removed.", cleanupError);
        }
    }

    internal static void SetLowIntegrity(string directory)
    {
        IntPtr descriptor;
        int size;
        Require(ConvertStringSecurityDescriptorToSecurityDescriptorW("S:(ML;OICI;NW;;;LW)", 1, out descriptor, out size),
            "Build scratch integrity label");
        try
        {
            bool present, defaulted;
            IntPtr sacl;
            Require(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted), "Read scratch integrity label");
            if (!present || sacl == IntPtr.Zero) throw new InvalidOperationException("The scratch integrity label is missing.");
            uint error = SetNamedSecurityInfoW(directory, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
            if (error != 0) throw new Win32Exception((int)error, "Set scratch integrity label failed.");
        }
        finally { LocalFree(descriptor); }
    }

    internal static int Run(Profile profile, string executable, string[] args, string workingDirectory, uint timeoutMs,
        uint processLimit = 1, uint memoryMiB = 256, SortedDictionary<string, string> extraEnvironment = null, string logPath = null,
        Func<bool> canceled = null)
    {
        if (canceled != null && canceled()) return 127;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw Failure("CreateJobObject");
        IntPtr list = IntPtr.Zero;
        IntPtr capabilities = IntPtr.Zero;
        IntPtr policy = IntPtr.Zero;
        IntPtr jobList = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;
        IntPtr handles = IntPtr.Zero;
        IntPtr output = IntPtr.Zero;
        IntPtr input = IntPtr.Zero;
        bool listInitialized = false;
        bool inJob = false;
        ProcessInformation child = new ProcessInformation();

        try
        {
            var limits = new ExtendedLimits();
            limits.Basic.LimitFlags = LimitActiveProcess | LimitJobMemory | KillOnJobClose;
            limits.Basic.ActiveProcessLimit = processLimit;
            limits.JobMemoryLimit = new UIntPtr(memoryMiB * 1024 * 1024);
            Require(SetInformationJobObject(job, JobExtendedLimits, ref limits, Marshal.SizeOf(limits)), "SetInformationJobObject memory and process limits");
            var cpu = new CpuRate { ControlFlags = CpuEnableHardCap, CpuRateUnits = 5000 };
            Require(SetInformationJobObject(job, JobCpuRateControl, ref cpu, Marshal.SizeOf(cpu)), "SetInformationJobObject CPU rate");

            IntPtr listSize = IntPtr.Zero;
            int attributes = 3 + (processLimit == 1 ? 1 : 0) + (logPath == null ? 0 : 1);
            InitializeProcThreadAttributeList(IntPtr.Zero, attributes, 0, ref listSize);
            if (listSize == IntPtr.Zero) throw Failure("Query process attribute list size");
            list = Marshal.AllocHGlobal(listSize);
            Require(InitializeProcThreadAttributeList(list, attributes, 0, ref listSize), "InitializeProcThreadAttributeList");
            listInitialized = true;

            var security = new SecurityCapabilities { AppContainerSid = profile.Sid };
            capabilities = Marshal.AllocHGlobal(Marshal.SizeOf(security));
            Marshal.StructureToPtr(security, capabilities, false);
            policy = Marshal.AllocHGlobal(sizeof(int));
            Marshal.WriteInt32(policy, PolicyEnabled);
            jobList = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobList, job);
            SetAttribute(list, SecurityCapabilitiesAttribute, capabilities, Marshal.SizeOf(security));
            SetAttribute(list, AllPackagesPolicyAttribute, policy, sizeof(int));
            if (processLimit == 1) SetAttribute(list, ChildProcessPolicyAttribute, policy, sizeof(int));
            SetAttribute(list, JobListAttribute, jobList, IntPtr.Size);

            var startup = new StartupInfoEx();
            startup.Startup.Size = Marshal.SizeOf(startup);
            startup.Attributes = list;
            if (logPath != null)
            {
                input = OpenInherited("NUL", 0x80000000, 3);
                output = OpenInherited(logPath, 0x40000000, 1);
                handles = Marshal.AllocHGlobal(IntPtr.Size * 2);
                Marshal.WriteIntPtr(handles, 0, input);
                Marshal.WriteIntPtr(handles, IntPtr.Size, output);
                SetAttribute(list, HandleListAttribute, handles, IntPtr.Size * 2);
                startup.Startup.Flags = 0x00000100;
                startup.Startup.StandardInput = input;
                startup.Startup.StandardOutput = output;
                startup.Startup.StandardError = output;
            }
            var command = new StringBuilder(Quote(executable));
            foreach (string argument in args) command.Append(' ').Append(Quote(argument));
            var variables = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "PATH", "" }, { "SystemRoot", Environment.GetFolderPath(Environment.SpecialFolder.Windows) },
                { "TEMP", workingDirectory }, { "TMP", workingDirectory },
            };
            if (extraEnvironment != null)
                foreach (var variable in extraEnvironment) variables.Add(variable.Key, variable.Value);
            var block = new StringBuilder();
            foreach (var variable in variables) block.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');
            environment = Marshal.StringToHGlobalUni(block.Append('\0').ToString());

            Require(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, logPath != null,
                CreateSuspended | CreateUnicodeEnvironment | ExtendedStartupInfo | CreateNoWindow,
                environment, workingDirectory, ref startup, out child), "CreateProcessW LPAC");
            Require(IsProcessInJob(child.Process, job, out inJob), "IsProcessInJob");
            if (!inJob) throw new InvalidOperationException("The suspended process was outside its job.");
            VerifyToken(child.Process, profile.Sid);
            if (canceled != null && canceled()) return StopJob(job, child.Process, 127);
            if (ResumeThread(child.Thread) != 1) throw Failure("ResumeThread");

            var clock = Stopwatch.StartNew();
            uint wait;
            while ((wait = WaitForSingleObject(child.Process, 100)) == WaitTimeout)
            {
                if (canceled != null && canceled()) return StopJob(job, child.Process, 127);
                if (clock.ElapsedMilliseconds >= timeoutMs) return StopJob(job, child.Process, 124);
                if (logPath != null && (new FileInfo(logPath).Length > 16384 || JobAccountingInfo(job).Io.WriteBytes > 512UL * 1024 * 1024))
                    return StopJob(job, child.Process, 125);
            }
            if (wait != WaitObject) throw Failure("WaitForSingleObject");
            uint exitCode;
            Require(GetExitCodeProcess(child.Process, out exitCode), "GetExitCodeProcess");
            // Finish the job before checking its output paths. A compiler child
            // must never retain access while the broker inspects those paths.
            if (JobAccountingInfo(job).Basic.ActiveProcesses != 0) StopJob(job, child.Process, exitCode);
            if (logPath != null && (new FileInfo(logPath).Length > 16384 || ScratchTooLarge(workingDirectory))) return 125;
            return unchecked((int)exitCode);
        }
        finally
        {
            // The kill-on-close job also covers failure before the process is resumed.
            if (!inJob && child.Process != IntPtr.Zero) TerminateProcess(child.Process, 1);
            CloseHandle(job);
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            if (listInitialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (capabilities != IntPtr.Zero) Marshal.FreeHGlobal(capabilities);
            if (policy != IntPtr.Zero) Marshal.FreeHGlobal(policy);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            if (input != IntPtr.Zero) CloseHandle(input);
            if (output != IntPtr.Zero) CloseHandle(output);
        }
    }

    private static int StopJob(IntPtr job, IntPtr child, uint exitCode)
    {
        Require(TerminateJobObject(job, exitCode), "TerminateJobObject");
        if (WaitForSingleObject(child, 3000) != WaitObject) throw new InvalidOperationException("The sandbox job did not stop.");
        var clock = Stopwatch.StartNew();
        while (JobAccountingInfo(job).Basic.ActiveProcesses != 0)
        {
            if (clock.ElapsedMilliseconds >= 3000) throw new InvalidOperationException("A sandbox descendant did not stop.");
            Thread.Sleep(10);
        }
        return unchecked((int)exitCode);
    }

    private static JobAccounting JobAccountingInfo(IntPtr job)
    {
        JobAccounting info;
        uint returned;
        Require(QueryInformationJobObject(job, JobBasicAndIoAccounting, out info, Marshal.SizeOf(typeof(JobAccounting)), out returned),
            "QueryInformationJobObject");
        return info;
    }

    private static bool ScratchTooLarge(string root)
    {
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return true;
        var directories = new Stack<string>();
        directories.Push(root);
        long bytes = 0;
        int entries = 0;
        while (directories.Count != 0)
        {
            foreach (string path in Directory.EnumerateFileSystemEntries(directories.Pop()))
            {
                FileAttributes attributes;
                try { attributes = File.GetAttributes(path); }
                catch (FileNotFoundException) { continue; }
                if ((attributes & FileAttributes.ReparsePoint) != 0 || ++entries > 16384) return true;
                if ((attributes & FileAttributes.Directory) != 0) directories.Push(path);
                else
                {
                    try { bytes += new FileInfo(path).Length; }
                    catch (FileNotFoundException) { continue; }
                    if (bytes > 512L * 1024 * 1024) return true;
                }
            }
        }
        return false;
    }

    private static IntPtr OpenInherited(string path, uint access, uint disposition)
    {
        var security = new SecurityAttributes { Length = Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = true };
        IntPtr handle = CreateFileW(path, access, 3, ref security, disposition, 0x80, IntPtr.Zero);
        if (handle == new IntPtr(-1)) throw Failure("CreateFileW for sandbox I/O");
        return handle;
    }

    private static bool CallerIsAppContainer()
    {
        IntPtr token;
        Require(OpenProcessToken(GetCurrentProcess(), TokenQuery, out token), "OpenProcessToken");
        try { return ReadTokenNumber(token, TokenIsAppContainer) != 0; }
        finally { CloseHandle(token); }
    }

    private static void VerifyToken(IntPtr process, IntPtr expectedSid)
    {
        IntPtr token;
        Require(OpenProcessToken(process, TokenQuery, out token), "OpenProcessToken");
        try
        {
            if (ReadTokenNumber(token, TokenIsAppContainer) != 1 || ReadTokenNumber(token, TokenIsLessPrivilegedAppContainer) != 1
                || ReadTokenNumber(token, TokenCapabilities) != 0)
                throw new InvalidOperationException("Windows did not apply the capability-free LPAC token.");
            IntPtr info = ReadToken(token, TokenAppContainerSid);
            try
            {
                if (!EqualSid(expectedSid, Marshal.ReadIntPtr(info)))
                    throw new InvalidOperationException("Windows assigned an unexpected AppContainer SID.");
            }
            finally { Marshal.FreeHGlobal(info); }
        }
        finally { CloseHandle(token); }
    }

    private static int ReadTokenNumber(IntPtr token, int kind)
    {
        IntPtr info = ReadToken(token, kind);
        try { return Marshal.ReadInt32(info); }
        finally { Marshal.FreeHGlobal(info); }
    }

    private static IntPtr ReadToken(IntPtr token, int kind)
    {
        int length;
        GetTokenInformation(token, kind, IntPtr.Zero, 0, out length);
        if (length <= 0) throw Failure("GetTokenInformation size");
        IntPtr info = Marshal.AllocHGlobal(length);
        if (GetTokenInformation(token, kind, info, length, out length)) return info;
        var failure = Failure("GetTokenInformation");
        Marshal.FreeHGlobal(info);
        throw failure;
    }

    private static void SetAttribute(IntPtr list, int kind, IntPtr value, int size)
    {
        Require(UpdateProcThreadAttribute(list, 0, new IntPtr(kind), value, new IntPtr(size), IntPtr.Zero, IntPtr.Zero),
            "UpdateProcThreadAttribute 0x" + kind.ToString("X"));
    }

    private static string Quote(string value)
    {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            output.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            output.Append(character);
            slashes = 0;
        }
        return output.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static Exception Failure(string operation)
    {
        int code = Marshal.GetLastWin32Error();
        return new Win32Exception(code, operation + " failed (Windows error " + code + ").");
    }

    private static void Require(bool success, string operation)
    {
        if (!success) throw Failure(operation);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityCapabilities
    {
        public IntPtr AppContainerSid, Capabilities;
        public int CapabilityCount, Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes { public int Length; public IntPtr Descriptor; public bool Inherit; }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public int Size;
        public IntPtr Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, ReservedSize;
        public IntPtr ReservedData, StandardInput, StandardOutput, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx { public StartupInfo Startup; public IntPtr Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr Process, Thread; public int ProcessId, ThreadId; }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessTimeLimit, PerJobTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobBasicAccounting
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint PageFaultCount, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobAccounting { public JobBasicAccounting Basic; public IoCounters Io; }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CpuRate { public uint ControlFlags, CpuRateUnits; }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int CreateAppContainerProfile(string name, string displayName, string description, IntPtr capabilities, int count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll", ExactSpelling = true)] private static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool EqualSid(IntPtr first, IntPtr second);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int length);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, int revision, out IntPtr descriptor, out int size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern uint SetNamedSecurityInfoW(string path, int kind, int information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits information, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref CpuRate information, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, out JobAccounting information, int size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inheritHandles,
        uint creationFlags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    private static extern IntPtr CreateFileW(string path, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint waitMs);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
}
