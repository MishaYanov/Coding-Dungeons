#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include "lld/Common/Driver.h"
#include "llvm/Support/raw_ostream.h"

#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

LLD_HAS_DRIVER(wasm)

int wmain(int argc, wchar_t **argv) {
    // Keep Windows argument decoding separate from LLVM's command-line
    // launcher, which tries to read the executable's parent directories.
    std::vector<std::string> utf8;
    utf8.reserve(argc);
    for (int i = 0; i < argc; ++i) {
        int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, nullptr, 0, nullptr, nullptr);
        if (size <= 0) {
            llvm::errs() << "Unable to decode a linker argument.\n";
            return 1;
        }
        std::string value(size, '\0');
        if (!WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, argv[i], -1, value.data(), size, nullptr, nullptr)) {
            llvm::errs() << "Unable to decode a linker argument.\n";
            return 1;
        }
        value.pop_back();
        utf8.push_back(std::move(value));
    }

    std::vector<const char *> args;
    args.reserve(utf8.size());
    for (const auto &value : utf8) args.push_back(value.c_str());
    auto result = lld::lldMain(args, llvm::outs(), llvm::errs(), {{lld::Wasm, &lld::wasm::link}});
    if (!result.canRunAgain) std::_Exit(result.retCode == 0 ? 1 : result.retCode);
    return result.retCode;
}
