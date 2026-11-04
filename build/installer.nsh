# Pi Desktop 自定义 NSIS 安装脚本
#
# 覆盖 electron-builder 默认模板的四个问题：
# 1) 安装目录名取自 exe 名（PiDesktop），与产品名「Pi Desktop」不一致；
# 2) 目录拼接是「子串包含」判断（assistedInstaller.nsh 的 instFilesPre），
#    会漏拼或重拼，出现 D:\Pi Desktop\Pi Desktop 这类目录；归一化改为在目录页
#    之后的隐藏页面里做一次（inner 实例也执行），升级只把旧目录名迁移为同级
#    产品名，不再追加子目录；
# 3) 占用检测按当前安装目录的前缀匹配进程，换目录安装时旧实例不被识别，
#    旧文件删不掉，安装以「无法关闭」失败。这里改为按进程名找实例，
#    先给应用自己退出的时间，超时再强制结束；
# 4) 更新时 addDesktopLink 走 keepShortcuts 分支，createDesktopShortcut: always
#    的重建被 isUpdated 挡住，快捷方式丢失或指向旧路径后不会自愈，这里在
#    customInstall 里强制重建。

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

# StdUtils 的插件目录在自定义 include 之后才注册，${isUpdated} 只能在
# 更晚展开的宏（installSection）里求值，结果存到 $PiIsUpdate。
!macro piDetectUpdateFlag
  ${If} ${isUpdated}
    StrCpy $PiIsUpdate "1"
  ${Else}
    StrCpy $PiIsUpdate "0"
  ${EndIf}
!macroend

!macro customCheckAppRunning
!ifdef BUILD_UNINSTALLER
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!else
  !insertmacro piPrepare
  Call piNormalizeInstallDir
  # $appExe 由 installSection 按修正前的目录赋值，快捷方式目标、DisplayIcon、
  # keepShortcuts 判断都取自它，目录改动后必须重新同步。
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !insertmacro piDetectUpdateFlag
  Call piEnsureAppClosed
!endif
!macroend

!ifndef BUILD_UNINSTALLER

Var /GLOBAL PiExeName
Var /GLOBAL PiDirPrevious
Var /GLOBAL PiAppRunning
Var /GLOBAL PiWaitBudget
Var /GLOBAL PiIsUpdate

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

# 归一化安装目录：
# - 已有安装且用户没改目录：只把旧目录名（如 PiDesktop）迁移为同级产品名，
#   绝不在上次安装目录内再追加一层；
# - 全新安装或用户改了目录：末段不是产品名时补齐。
Function piNormalizeInstallDir
  StrCpy $R0 "$INSTDIR"
  Call piTrimTrailingSlash
  StrCpy $INSTDIR "$R0"

  StrCmp $PiDirPrevious "" piNormFresh
  StrCpy $R0 "$PiDirPrevious"
  Call piTrimTrailingSlash
  StrCmp $INSTDIR $R0 piNormMigrate piNormFresh

piNormMigrate:
  Call piSplitPath
  StrCmp $R1 "${APP_FILENAME}" piNormDone
  StrCmp $R2 "" piNormDone
  StrCpy $INSTDIR "$R2\${APP_FILENAME}"
  Goto piNormDone

piNormFresh:
  StrCpy $R0 "$INSTDIR"
  Call piSplitPath
  StrCmp $R1 "${APP_FILENAME}" piNormDone
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"

piNormDone:
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

# 请求应用自行退出（不发强制结束信号）。更新时安装器是 app 的子进程，
# 带 /T 会连安装器一起终止，只关主进程；手动安装时安装器不在该进程树里。
Function piRequestAppClose
  ${If} $PiIsUpdate == "1"
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName"`
  ${Else}
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName" /T`
  ${EndIf}
  Pop $R0
FunctionEnd

# 强制结束应用（含子进程）
Function piKillApp
  ${If} $PiIsUpdate == "1"
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName" /F`
  ${Else}
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C taskkill /IM "$PiExeName" /T /F`
  ${EndIf}
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

# --updated：沿用上次安装模式并跳过安装模式页，避免更新时误切 per-user/per-machine。
# 两个注册表位置都有安装时保持页面可见，交给用户选。
!macro customInstallMode
  ${If} ${isUpdated}
    ReadRegStr $R5 HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $R6 HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R5 != ""
    ${AndIf} $R6 == ""
      StrCpy $isForceMachineInstall "1"
    ${ElseIf} $R5 == ""
    ${AndIf} $R6 != ""
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

# 目录页之后、写入之前归一化：安装模式页的 leave 会按注册表重置 $INSTDIR，
# 放在 customInit 里会被覆盖；inner 实例又不执行 customCheckAppRunning。
# 这里加一个在 PRE 里直接 Abort 的隐藏页面，两条路径都能覆盖。
# 函数写在宏里：宏在 assistedInstaller.nsh 处展开，此时 registry 与 exe 名的
# 编译期 define 已由 common.nsh / multiUser.nsh 提供。
!macro customPageAfterChangeDir
  Function piNormalizePagePre
    !insertmacro piPrepare
    Call piNormalizeInstallDir
    Abort
  FunctionEnd

  Function piNormalizePageLeave
  FunctionEnd

  PageEx custom
    PageCallbacks piNormalizePagePre piNormalizePageLeave
    Caption " "
  PageExEnd
!macroend

# 在 addDesktopLink 之后执行：更新走 keepShortcuts 分支时不会重建快捷方式，
# 这里按 createDesktopShortcut: always 的语义强制写一次。
!macro customInstall
  !ifdef RECREATE_DESKTOP_SHORTCUT
    ${IfNot} ${isNoDesktopShortcut}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
  !endif
!macroend

!endif
