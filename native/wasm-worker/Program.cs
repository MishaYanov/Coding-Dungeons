using System.Globalization;
using Wasmtime;
using WasmModule = Wasmtime.Module;

// The broker reads this trusted host process exit code. The WASI guest never
// receives a host stdout, stdin, filesystem, network, or environment handle.
const int wrongAnswer = 10;
const int fuelExhausted = 11;
const int invalidArtifact = 12;
const int artifactLimit = 16 * 1024 * 1024;
const long guestMemory = 128 * 1024 * 1024;

if (args.Length != 2 || !int.TryParse(args[1], NumberStyles.None, CultureInfo.InvariantCulture, out int index)
    || index < 0 || index >= 32) return invalidArtifact;

try
{
    var artifact = new FileInfo(args[0]);
    if (!artifact.Exists || artifact.Length < 8 || artifact.Length > artifactLimit) return invalidArtifact;
    // Explicit Wasm checks avoid hardware trap recovery through Windows shadow stacks.
    using var config = new Config().WithFuelConsumption(true).WithWasmThreads(false).WithSignalsBasedTraps(false);
    using var engine = new Engine(config);
    using var module = WasmModule.FromFile(engine, artifact.FullName);
    using var linker = new Linker(engine);
    linker.DefineWasi();
    using var store = new Store(engine);
    store.Fuel = 30_000_000;
    store.SetLimits(memorySize: guestMemory, tableElements: 20_000, instances: 1, tables: 2, memories: 1);
    store.SetWasiConfiguration(new WasiConfiguration());

    var instance = linker.Instantiate(store, module);
    instance.GetAction("_initialize")?.Invoke();
    var check = instance.GetFunction<int, int>("coding_dungeons_run_case");
    if (check == null) return invalidArtifact;
    return check(index) == 1 ? 0 : wrongAnswer;
}
catch (TrapException error) when (error.Type == TrapCode.OutOfFuel)
{
    return fuelExhausted;
}
catch (WasmtimeException)
{
    // A guest proc_exit(0) also takes this path. A pass requires a normal return.
    return wrongAnswer;
}
catch (IOException)
{
    return invalidArtifact;
}
catch (UnauthorizedAccessException)
{
    return invalidArtifact;
}
