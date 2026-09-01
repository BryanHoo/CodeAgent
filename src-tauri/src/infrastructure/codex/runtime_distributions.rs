use super::runtime_manager::Distribution;

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-darwin-arm64.tgz",
    integrity: "g7YzpaCZGCw19R/gly3vRPjnLqaW7JcBAu2WQQ6e8PIlvBPmS/gMplIUURMgNO6gi8LsPzdlQtLqkwoeOOlIdg==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-linux-arm64.tgz",
    integrity: "CsLgFeX4TQ6I2Gdrxd2r5UbgIbDLCdtcLAlnMYjr06bCL057MTNGec7Ewb3+Z2DBiMuXCljdTBGqLOePkMV0sQ==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-linux-x64.tgz",
    integrity: "xcVyY1FtwvVYhh2JBmz8fX8CQqFAxO/lxJ2IXsh8x5uwxZVHVl5fZHFHf8JdRaOGG0vpkYmu/DKKVoLd56/DDQ==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-win32-arm64.tgz",
    integrity: "zDWzOoh9wHm+Om1Nhn7os47rAVeSGPh0SnM3YOttdq6iPJz2zn4vBnbGUZjeih1qW/3mvNF3Oyd4owlaHmphmg==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.151.0-win32-x64.tgz",
    integrity: "sLT7xvID3jhU6tkzcwRPnMEclKRwUPbpo0mtfxIF9KpdZH3VJV7sM2/kXWXyvUM7Zt/YeyOaeATTEysbRz8Yog==",
};
