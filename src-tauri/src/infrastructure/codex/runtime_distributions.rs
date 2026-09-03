use super::runtime_manager::Distribution;

pub(super) const DARWIN_ARM64: Distribution = Distribution {
    target: "aarch64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-darwin-arm64.tgz",
    integrity: "H8i0uZHILM0Z2Ep+MryCF5rGXmXjmXTzXf5ZK6bobKtZc2yfomi42ZrQWuYQ5P02H0oLG7B5jLaSWZQ+VFgjbA==",
};
pub(super) const LINUX_ARM64: Distribution = Distribution {
    target: "aarch64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-linux-arm64.tgz",
    integrity: "qZXqf7fxn/SCmaJW6tYrzWqwcDo0gMDJjj1Pm4OtrWXR7Oc0Y2e8ngAh/Mep9iFhVbsqntY1eGLaQaXssGvFgA==",
};
pub(super) const LINUX_X64: Distribution = Distribution {
    target: "x86_64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-linux-x64.tgz",
    integrity: "ar59rr3CX5j4MLMnRcHqcE0eHZPsZlmXlz37ZS2yP3BsV5pNhO+wFXTOzXFdaYmg2cALX7a3Eqv+vB2jQlXnjQ==",
};
pub(super) const WINDOWS_ARM64: Distribution = Distribution {
    target: "aarch64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-win32-arm64.tgz",
    integrity: "YZjWCcArfSLlqG/4r2Ox5ZZhz1FAFQBZisz8U8r5JLxeLk0tXwZHleu8RjNjly++0S5zsgPtAuF0viSIj7NyRA==",
};
pub(super) const WINDOWS_X64: Distribution = Distribution {
    target: "x86_64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.152.1-win32-x64.tgz",
    integrity: "B8h0/2Kt+rKQv2+vqBhlhWkMEdhf4dsn46FNKMEBTXj3YC5hwSioOcTX2hMgJxMEMtKIMH6Ire1eNrQPvaL9og==",
};
