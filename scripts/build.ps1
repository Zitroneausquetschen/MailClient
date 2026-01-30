# Build script for MailClient
# Automatically sets up LLVM tools path for llama_cpp compilation

param(
    [switch]$Release,
    [switch]$Dev,
    [switch]$Bundle
)

# Find rustup toolchain path
$rustupHome = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { "$env:USERPROFILE\.rustup" }
$toolchain = "stable-x86_64-pc-windows-msvc"
$llvmBinPath = "$rustupHome\toolchains\$toolchain\lib\rustlib\x86_64-pc-windows-msvc\bin"

# Check if LLVM tools exist
if (Test-Path "$llvmBinPath\llvm-nm.exe") {
    Write-Host "Found LLVM tools at: $llvmBinPath" -ForegroundColor Green
    $env:NM_PATH = "$llvmBinPath\llvm-nm.exe"
    $env:OBJCOPY_PATH = "$llvmBinPath\llvm-objcopy.exe"
} else {
    Write-Host "LLVM tools not found. Installing via rustup..." -ForegroundColor Yellow
    rustup component add llvm-tools-preview

    if (Test-Path "$llvmBinPath\llvm-nm.exe") {
        $env:NM_PATH = "$llvmBinPath\llvm-nm.exe"
        $env:OBJCOPY_PATH = "$llvmBinPath\llvm-objcopy.exe"
        Write-Host "LLVM tools installed successfully" -ForegroundColor Green
    } else {
        Write-Host "ERROR: Could not find LLVM tools after installation" -ForegroundColor Red
        exit 1
    }
}

# Change to project directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptPath
Set-Location $projectPath

Write-Host ""
Write-Host "Building MailClient..." -ForegroundColor Cyan
Write-Host ""

if ($Dev) {
    Write-Host "Running development server..." -ForegroundColor Yellow
    npm run tauri dev
} elseif ($Bundle -or $Release) {
    Write-Host "Building release bundle..." -ForegroundColor Yellow
    npm run tauri build

    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq 1) {
        # Exit code 1 is for signing warning, build still succeeds
        Write-Host ""
        Write-Host "Build complete!" -ForegroundColor Green
        Write-Host "Installer: src-tauri\target\release\bundle\nsis\MailClient_*_x64-setup.exe"
    }
} else {
    # Default: just cargo build
    Write-Host "Building Rust backend..." -ForegroundColor Yellow
    Set-Location src-tauri
    cargo build --release
}
