cmake_minimum_required(VERSION 3.20)
project(CodingDungeonsWasmLinker LANGUAGES CXX)

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
find_package(LLVM 23.1.1 EXACT CONFIG REQUIRED)
find_package(LLD CONFIG REQUIRED)

add_executable(wasm-linker main.cpp)
target_compile_features(wasm-linker PRIVATE cxx_std_17)
target_include_directories(wasm-linker SYSTEM PRIVATE ${LLVM_INCLUDE_DIRS} ${LLD_INCLUDE_DIRS})
target_link_libraries(wasm-linker PRIVATE lldWasm lldCommon)
