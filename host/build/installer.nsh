!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "${MAINBINARYNAME}.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "aether-remote-host.exe"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "${MAINBINARYNAME}.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "aether-remote-host.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AetherHost"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Host"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Discovery"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote mDNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Host Out"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Aether Remote Host" dir=in action=allow protocol=TCP localport=8080 profile=any remoteip=localsubnet,100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 program="$INSTDIR\${MAINBINARYNAME}.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Aether Remote Discovery" dir=in action=allow protocol=UDP localport=8081 profile=any remoteip=localsubnet,100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 program="$INSTDIR\${MAINBINARYNAME}.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Aether Remote mDNS" dir=in action=allow protocol=UDP localport=5353 profile=any remoteip=localsubnet program="$INSTDIR\${MAINBINARYNAME}.exe"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Aether Remote Host Out" dir=out action=allow protocol=UDP localport=8081 profile=any program="$INSTDIR\${MAINBINARYNAME}.exe"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Host"'
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Discovery"'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AetherRemote"
  ${EndIf}
!macroend
