; NSIS Installer Script for Anz Video Publisher
; Custom installation steps

!macro customInstall
  ; Create FFmpeg directory if not exists
  CreateDirectory "$INSTDIR\resources\ffmpeg"
  
  ; Add to PATH (optional)
  ; Push "$INSTDIR"
  ; Call AddToPath
!macroend

!macro customUnInstall
  ; Clean up temp files
  RMDir /r "$TEMP\anz-video-publisher"
!macroend
