!macro customInit
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\d7288f4b-4526-502e-a946-38a0e69290ee" "DisplayVersion"
  StrCmp $0 "" no_existing_version
  MessageBox MB_ICONQUESTION|MB_YESNO "Найдена установленная версия Aether Remote $0. Заменить её новой версией?" /SD IDYES IDYES no_existing_version
  Abort
no_existing_version:
!macroend

!macro customInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AetherHost"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Host"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Aether Remote Host" dir=in action=allow protocol=TCP localport=8080 profile=any remoteip=localsubnet,100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 program="$INSTDIR\Aether Remote.exe"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Aether Remote Host"'
!macroend
