import React from 'react';
import { useDropzone } from 'react-dropzone';

function UploadZone({ onUpload, accept, children }) {
  // FIX: Default accept menggunakan format react-dropzone v14
  const defaultAccept = { 'video/*': ['.mp4', '.mkv', '.mov', '.avi', '.webm'] };
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onUpload,
    accept: accept || defaultAccept,
    multiple: false
  });

  return (
    <div
      {...getRootProps()}
      className={`dropzone ${isDragActive ? 'active' : ''}`}
    >
      <input {...getInputProps()} />
      {children || (
        <div>
          {isDragActive ? (
            <p>Drop video di sini...</p>
          ) : (
            <p>Drag & drop video di sini, atau klik untuk memilih</p>
          )}
        </div>
      )}
    </div>
  );
}

export default UploadZone;
