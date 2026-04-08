import React from 'react';
import { useDropzone } from 'react-dropzone';

function UploadZone({ onUpload, accept = 'video/*', children }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onUpload,
    accept: accept,
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
            <p>Drop the video here...</p>
          ) : (
            <p>Drag & drop video here, or click to select</p>
          )}
        </div>
      )}
    </div>
  );
}

export default UploadZone;
