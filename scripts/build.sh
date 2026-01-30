#!/bin/bash
# Build script for MailClient
# Automatically sets up LLVM tools path for llama_cpp compilation

set -e

# Find rustup toolchain path
RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
TOOLCHAIN="stable-x86_64-pc-windows-msvc"
LLVM_BIN_PATH="$RUSTUP_HOME/toolchains/$TOOLCHAIN/lib/rustlib/x86_64-pc-windows-msvc/bin"

# Check if LLVM tools exist
if [ -f "$LLVM_BIN_PATH/llvm-nm.exe" ]; then
    echo -e "\033[32mFound LLVM tools at: $LLVM_BIN_PATH\033[0m"
    export NM_PATH="$LLVM_BIN_PATH/llvm-nm.exe"
    export OBJCOPY_PATH="$LLVM_BIN_PATH/llvm-objcopy.exe"
else
    echo -e "\033[33mLLVM tools not found. Installing via rustup...\033[0m"
    rustup component add llvm-tools-preview

    if [ -f "$LLVM_BIN_PATH/llvm-nm.exe" ]; then
        export NM_PATH="$LLVM_BIN_PATH/llvm-nm.exe"
        export OBJCOPY_PATH="$LLVM_BIN_PATH/llvm-objcopy.exe"
        echo -e "\033[32mLLVM tools installed successfully\033[0m"
    else
        echo -e "\033[31mERROR: Could not find LLVM tools after installation\033[0m"
        exit 1
    fi
fi

# Change to project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo ""
echo -e "\033[36mBuilding MailClient...\033[0m"
echo ""

case "${1:-build}" in
    dev)
        echo -e "\033[33mRunning development server...\033[0m"
        npm run tauri dev
        ;;
    build|release|bundle)
        echo -e "\033[33mBuilding release bundle...\033[0m"
        npm run tauri build
        echo ""
        echo -e "\033[32mBuild complete!\033[0m"
        echo "Installer: src-tauri/target/release/bundle/nsis/MailClient_*_x64-setup.exe"
        ;;
    cargo)
        echo -e "\033[33mBuilding Rust backend only...\033[0m"
        cd src-tauri
        cargo build --release
        ;;
    *)
        echo "Usage: $0 [dev|build|cargo]"
        echo "  dev   - Run development server"
        echo "  build - Build release bundle (default)"
        echo "  cargo - Build Rust backend only"
        exit 1
        ;;
esac
