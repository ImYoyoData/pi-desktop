# Pi Desktop 自定义 NSIS 安装脚本
#
# 覆盖 electron-builder 默认模板的三个问题：
# 1) 安装目录名取自 exe 名（PiDesktop），与产品名「Pi Desktop」不一致；
# 2) 目录拼接是「子串包含」判断（assistedInstaller.nsh 的 instFilesPre），
#    会漏拼或重拼，出现 D:\Pi Desktop\Pi Desktop 这类目录；
# 3) 占用检测按当前安装目录的前缀匹配进程，换目录安装时旧实例不被识别，
#    旧文件删不掉，安装以「无法关闭」失败。这里改为按进程名找实例，
#    先给应用自己退出的时间，超时再强制结束。

!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "Pi Desktop"

!include LogicLib.nsh

!ifdef BUILD_UNINSTALLER
  # electron-builder 在存在 customCheckAppRunning 时会跳过 getProcessInfo.nsh，
  # 卸载器的默认检测仍依赖它，这里补回依赖。
  !include "getProcessInfo.nsh"
  Var pid
!endif

!macro piPrepare
  StrCpy $PiExeName "${APP_EXECUTABLE_FILENAME}"
  ReadRegStr $PiDirPrevious SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
!macroend

!macro customCheckAppRunning
!ifdef BUILD_UNINSTALLER
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!else
  !insertmacro piPrepare
  Call piFixInstallDirectory
  Call piEnsureAppClosed
!endif
!macroend

!ifndef BUILD_UNINSTALLER

Var /GLOBAL PiExeName
Var /GLOBAL PiDirPrevious
Var /GLOBAL PiAppRunning
Var /GLOBAL PiWaitBudget

# 去掉路径末尾的反斜杠（就地处理 $R0；用 $R9 暂存，避免覆盖调用方要用的 $R1）
Function piTrimTrailingSlash
  loop:
    StrCpy $R9 $R0 1 -1
    ${If} $R9 != "\"
      Goto done
    ${EndIf}
    StrCpy $R0 $R0 -1
    Goto loop
  done:
FunctionEnd

# 拆分路径：输入 $R0；输出 $R1 = 末段，$R2 = 父目录（不含末尾分隔符）。
# 纯 NSIS 实现：自定义 include 位于 !addplugindir 之前，此时插件目录还没注册，
# 不能调用 StdUtils 之类的插件。
Function piSplitPath
  StrCpy $R1 ""
  StrCpy $R2 ""
  StrCpy $R3 "$R0"

  trim:
    StrCpy $R4 $R3 1 -1
    ${If} $R4 != "\"
      Goto trimDone
    ${EndIf}
    StrCpy $R3 $R3 -1
    Goto trim

  trimDone:
    StrCmp $R3 "" splitDone
    StrCpy $R5 -1
    StrCpy $R8 0

  scan:
    StrCpy $R6 $R3 1 $R8
    ${If} $R6 == ""
      Goto scanDone
    ${EndIf}
    ${If} $R6 == "\"
      StrCpy $R5 $R8
    ${EndIf}
    IntOp $R8 $R8 + 1
    Goto scan

  scanDone:
    ${If} $R5 == -1
      StrCpy $R1 $R3
      Goto splitDone
    ${EndIf}
    StrCpy $R2 $R3 $R5
    IntOp $R7 $R5 + 1
    StrCpy $R1 $R3 "" $R7

  splitDone:
FunctionEnd

# 修正安装目录：
# - 末段不是产品目录时补齐（按路径段判断，不做子串匹配）；
# - 末段是产品目录、但父目录正好是上次安装目录时，去掉 electron-builder 多拼的一层。
Function piFixInstallDirectory
  StrCpy $R0 "$INSTDIR"
  Call piTrimTrailingSlash
  StrCpy $INSTDIR "$R0"

  Call piSplitPath

  StrCpy $R0 "$PiDirPrevious"
  Call piTrimTrailingSlash
  StrCpy $R4 "$R0"

  StrCmp $R1 "${APP_FILENAME}" 0 piAppendFolder
  StrCmp $R4 "" piDone
  StrCmp $R2 $R4 piDropLeaf piDone

piDropLeaf:
  StrCpy $INSTDIR "$R2"
  Goto piDone

piAppendFolder:
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"

piDone:
FunctionEnd

# 是否有运行中的实例：$PiAppRunning = 1 表示有
Function piIsAppRunning
  StrCpy $PiAppRunning 0
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq $PiExeName" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"$PiExeName\""`
  Pop $R0
  ${If} $R0 == 0
    StrCpy $PiAppRunning 1
  ${EndIf}
FunctionEnd

# 请求应用自行退出（不发强制结束信号）
Function piRequestAppClose
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName" /T`
  Pop $R0
FunctionEnd

# 强制结束应用（含子进程）
Function piKillApp
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName" /T /F`
  Pop $R0
FunctionEnd

# 等待应用退出：预算毫秒数放在 $PiWaitBudget，返回后 $PiAppRunning = 1 表示仍在运行
Function piWaitAppExit
  Call piIsAppRunning
  ${If} $PiAppRunning == 0
    Return
  ${EndIf}
  loop:
    Sleep 500
    IntOp $PiWaitBudget $PiWaitBudget - 500
    ${If} $PiWaitBudget <= 0
      StrCpy $PiAppRunning 1
      Return
    ${EndIf}
    Call piIsAppRunning
    ${If} $PiAppRunning == 0
      Return
    ${EndIf}
    Goto loop
FunctionEnd

# 关闭运行中的实例：先等应用自己退出（更新安装时应用会自行退出），
# 仍未退出再提示用户并自动关闭，最后才强制结束。
Function piEnsureAppClosed
  Call piIsAppRunning
  ${If} $PiAppRunning == 0
    Return
  ${EndIf}

  DetailPrint "等待 Pi Desktop 退出…"
  StrCpy $PiWaitBudget 8000
  Call piWaitAppExit
  ${If} $PiAppRunning == 0
    Return
  ${EndIf}

  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "检测到 Pi Desktop 正在运行，需要先关闭才能继续安装。点击「确定」自动关闭并继续安装。" /SD IDOK IDOK piAutoClose
  SetErrorLevel 2
  Quit

piAutoClose:
  DetailPrint "正在关闭 Pi Desktop…"
  Call piRequestAppClose
  StrCpy $PiWaitBudget 8000
  Call piWaitAppExit
  ${If} $PiAppRunning == 1
    Call piKillApp
    StrCpy $PiWaitBudget 5000
    Call piWaitAppExit
  ${EndIf}
  Goto piVerifyClosed

piVerifyClosed:
  Call piIsAppRunning
  ${If} $PiAppRunning == 0
    Return
  ${EndIf}
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法关闭 Pi Desktop（可能以管理员身份运行），请手动关闭后点击「重试」继续安装。" /SD IDCANCEL IDRETRY piRetryClose
  SetErrorLevel 2
  Quit

piRetryClose:
  Call piRequestAppClose
  StrCpy $PiWaitBudget 8000
  Call piWaitAppExit
  ${If} $PiAppRunning == 1
    Call piKillApp
    StrCpy $PiWaitBudget 5000
    Call piWaitAppExit
  ${EndIf}
  Call piIsAppRunning
  ${If} $PiAppRunning == 1
    MessageBox MB_OK|MB_ICONEXCLAMATION "仍然无法关闭 Pi Desktop，请手动关闭后重新运行安装程序。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

!endif
