param([ValidateSet('dev','release')][string]$Preset='release',[switch]$Launch)
$ErrorActionPreference='Stop'
$mvcadRoot=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $mvcadRoot
$mvcadVs=Join-Path $mvcadRoot '.tools\vs2022\Common7\Tools\VsDevCmd.bat'
if(!(Test-Path -LiteralPath $mvcadVs)){
    $mvcadWhere='C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
    if(Test-Path -LiteralPath $mvcadWhere){
        $mvcadVsRoot=& $mvcadWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if($mvcadVsRoot){$mvcadVs=Join-Path $mvcadVsRoot 'Common7\Tools\VsDevCmd.bat'}
    }
}
if(!(Test-Path -LiteralPath $mvcadVs)){throw 'Install Visual Studio 2022 C++ Build Tools first.'}
$mvcadEnvCommand='"{0}" -arch=x64 -host_arch=x64 >nul && set' -f $mvcadVs
$mvcadEnv=& cmd.exe /d /s /c $mvcadEnvCommand
if($LASTEXITCODE -ne 0){throw 'Could not initialize MSVC environment.'}
foreach($mvcadLine in $mvcadEnv){
    if($mvcadLine -match '^([^=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}
}
$mvcadPythonTools=Join-Path $mvcadRoot '.tools\python\Scripts'
$mvcadQt=Join-Path $mvcadRoot '.tools\Qt\6.8.3\msvc2022_64'
if(Test-Path -LiteralPath $mvcadPythonTools){$env:PATH="$mvcadPythonTools;$env:PATH"}
if(Test-Path -LiteralPath $mvcadQt){$env:CMAKE_PREFIX_PATH=$mvcadQt;$env:PATH="$mvcadQt\bin;$env:PATH"}
$mvcadOcct=Join-Path $mvcadRoot '.tools\occt\bin'
if(Test-Path -LiteralPath $mvcadOcct){$env:PATH="$mvcadOcct;$env:PATH"}
cmake --preset $Preset
if($LASTEXITCODE -ne 0){throw 'CMake configure failed.'}
cmake --build --preset $Preset --parallel
if($LASTEXITCODE -ne 0){throw 'Build failed.'}
ctest --preset $Preset
if($LASTEXITCODE -ne 0){throw 'Tests failed.'}
if($Launch){& (Join-Path $mvcadRoot "build\$Preset\MVCAD.exe")}
