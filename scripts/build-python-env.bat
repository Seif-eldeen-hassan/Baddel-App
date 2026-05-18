@echo off
REM ================================================================
REM build-python-env.bat
REM Creates a portable Windows Python venv for the Steam bridge.
REM Run this once before `npm run dist`.  Requires Python 3.11 (or
REM any 3.x) installed via the official Windows launcher (py.exe).
REM End-user machines do NOT need Python installed.
REM ================================================================

setlocal ENABLEEXTENSIONS

set ROOT=%~dp0..
set VENV=%ROOT%\python_env
set REQS=%ROOT%\baddel-steam-integration\requirements\app.txt

REM ── Locate Python via the Windows Launcher (py.exe) ─────────────
REM Prefer 3.11 explicitly; fall back to any 3.x.

set PY=
where py >nul 2>&1
if ERRORLEVEL 1 (
    echo ERROR: py.exe not found. Install Python 3.11 from python.org
    echo        and make sure "py launcher" is checked during installation.
    exit /b 1
)

py -3.11 --version >nul 2>&1
if NOT ERRORLEVEL 1 (
    set PY=py -3.11
    goto :found_python
)

py -3 --version >nul 2>&1
if NOT ERRORLEVEL 1 (
    set PY=py -3
    goto :found_python
)

echo ERROR: No Python 3.x found via py launcher. Install Python 3.11 from python.org.
exit /b 1

:found_python
echo [build-python-env] Using: %PY%
%PY% --version

REM ── Create venv ──────────────────────────────────────────────────
echo [build-python-env] Creating venv at %VENV%
if exist "%VENV%" (
    echo [build-python-env] Removing existing venv...
    rmdir /s /q "%VENV%"
)

%PY% -m venv --copies "%VENV%"
if ERRORLEVEL 1 (
    echo ERROR: Failed to create venv.
    exit /b 1
)

REM ── Verify Windows layout (Scripts\, not bin\) ───────────────────
if not exist "%VENV%\Scripts\python.exe" (
    echo ERROR: Expected Windows venv layout but Scripts\python.exe is missing.
    if exist "%VENV%\bin\" (
        echo        Found bin\ instead of Scripts\ -- this is not a Windows venv.
        echo        Run this script on Windows with a native Windows Python install.
    )
    exit /b 1
)
echo [build-python-env] Venv layout OK: %VENV%\Scripts\python.exe

REM ── Install dependencies ─────────────────────────────────────────
echo [build-python-env] Upgrading pip...
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip --quiet
if ERRORLEVEL 1 (
    echo ERROR: pip upgrade failed.
    exit /b 1
)

echo [build-python-env] Installing dependencies from %REQS%
"%VENV%\Scripts\python.exe" -m pip install -r "%REQS%"
if ERRORLEVEL 1 (
    echo ERROR: pip install failed.
    exit /b 1
)

REM ── Verify key packages ──────────────────────────────────────────
echo [build-python-env] Verifying key packages...
"%VENV%\Scripts\python.exe" -c "import aiohttp, certifi, cryptography, websockets, rsa, google.protobuf; print('  packages OK')"
if ERRORLEVEL 1 (
    echo ERROR: Package verification failed. Check the output above for details.
    exit /b 1
)

echo.
echo [build-python-env] Done.
echo   python_env\Scripts\python.exe is ready for electron-builder.
echo   Run `npm run dist` to build the installer.
endlocal
