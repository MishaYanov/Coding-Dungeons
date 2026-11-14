// Exact experimental browser toolchain. The desktop/book target remains 1.99.1.
// A new binary requires a pin update and the complete Rust compatibility suite.
export const rustToolchain = Object.freeze({
  version:1, rustVersion:'1.96.0-dev', experimental:true,
  artifactRelease:'artifacts-test-7', compilerRevision:null,
  compiler:'rustc.wasm', sysroot:'sysroot.bundle',
  files:Object.freeze({
    'rustc.wasm':'41412081eefc3e08ec5664ed0748902a7e575e1f267898dcc64d412702df7e83',
    'sysroot.bundle':'6dba13d6077cb7936ed6661cd1087bc9e92dc1d8b35903ecf22881c97ac3980b',
  }),
  sizes:Object.freeze({'rustc.wasm':87871387,'sysroot.bundle':71313335}),
});

export const rustArchives = Object.freeze([
  Object.freeze({name:'rustc-wasm.tar.zst', size:17206482,
    sha256:'a96f6d53afff3c95d6387def27f6ddb53a02575679dc6c981d60797c32dcd022',
    entry:'rustc/rustc.wasm', output:'rustc.wasm'}),
  Object.freeze({name:'wasip1-sysroot.tar.zst', size:43403178,
    sha256:'4eedff7b0cd4330bfe226734b67751a97fac5572ac55392e93f9d3e4886a277d',
    entry:'rustc/sysroot-wasip1.bundle', output:'sysroot.bundle'}),
]);
